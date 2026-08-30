#!/usr/bin/env node
/**
 * Shop Web — end-to-end RLS security test (over real HTTP, real logins).
 *
 * Signs in as seller A and attempts five things that MUST fail:
 *   1. read seller B's hidden products
 *   2. edit seller B's product
 *   3. insert a product under seller B's shop
 *   4. make itself an admin
 *   5. extend its own subscription expiry
 *
 * A denial counts either as an error OR as zero rows affected — so every
 * test also re-reads the data with the service key to prove nothing moved.
 *
 * Run:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/security-test.mjs
 *
 * The service_role key is used ONLY here, only to set up and tear down
 * the two test sellers. It never reaches the browser.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://kvwgiobnpwrjwyevadvc.supabase.co';
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_j6YHgYneV4Bfox79hrxH7g_0r28MsBg';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
      'Get it from Supabase → Project Settings → API → service_role, and pass it\n' +
      'on the command line. Do not commit it and do not put it in front-end code.',
  );
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SELLER_A = { email: 'sectest-a@shop-web.test', password: 'SecTestA!2026' };
const SELLER_B = { email: 'sectest-b@shop-web.test', password: 'SecTestB!2026' };

const results = [];
function record(n, name, denied, detail) {
  results.push({ n, name, denied, detail });
}

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function resetUser({ email, password }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    // payments have ON DELETE RESTRICT, so clear them before the cascade
    const { data: shops } = await admin.from('shops').select('id').eq('owner_id', existing.id);
    for (const s of shops ?? []) {
      await admin.from('payments').delete().eq('shop_id', s.id);
      await admin.from('deleted_objects').delete().eq('shop_id', s.id);
    }
    await admin.auth.admin.deleteUser(existing.id);
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function setup() {
  const a = await resetUser(SELLER_A);
  const b = await resetUser(SELLER_B);

  const { data: cats, error: catErr } = await admin
    .from('platform_categories')
    .select('id')
    .order('sort_order')
    .limit(1);
  if (catErr) throw catErr;
  if (!cats?.length) throw new Error('platform_categories is empty — run the seed migration');
  const category = cats[0].id;

  const { data: shopA, error: e1 } = await admin
    .from('shops')
    .insert({ owner_id: a.id, slug: 'sectest-a', name: 'Seller A', whatsapp: '+9647500000001' })
    .select('id')
    .single();
  if (e1) throw e1;

  const { data: shopB, error: e2 } = await admin
    .from('shops')
    .insert({ owner_id: b.id, slug: 'sectest-b', name: 'Seller B', whatsapp: '+9647500000002' })
    .select('id')
    .single();
  if (e2) throw e2;

  const { data: prodB, error: e3 } = await admin
    .from('products')
    .insert({
      shop_id: shopB.id,
      platform_category_id: category,
      title: 'B secret product',
      description: 'hidden from everyone but B',
      price: 25000,
      status: 'hidden',
    })
    .select('id, title, price')
    .single();
  if (e3) throw e3;

  return { a, b, shopA: shopA.id, shopB: shopB.id, prodB, category };
}

async function teardown() {
  for (const { email } of [SELLER_A, SELLER_B]) {
    const user = await findUserByEmail(email);
    if (!user) continue;
    const { data: shops } = await admin.from('shops').select('id').eq('owner_id', user.id);
    for (const s of shops ?? []) {
      await admin.from('payments').delete().eq('shop_id', s.id);
      await admin.from('deleted_objects').delete().eq('shop_id', s.id);
    }
    await admin.auth.admin.deleteUser(user.id);
  }
}

async function run() {
  const ctx = await setup();

  // Seller A, signed in through the public API with the publishable key.
  const sellerA = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInErr } = await sellerA.auth.signInWithPassword(SELLER_A);
  if (signInErr) throw signInErr;

  // ---- 1. read seller B's hidden products -------------------------
  {
    const { data, error } = await sellerA
      .from('products')
      .select('id, title')
      .eq('shop_id', ctx.shopB)
      .eq('status', 'hidden');
    const denied = !!error || (data ?? []).length === 0;
    record(1, "seller A reads seller B's hidden products", denied,
      error ? `${error.message} (${error.code})` : `returned ${(data ?? []).length} row(s)`);
  }

  // ---- 2. edit seller B's product ---------------------------------
  {
    const { data, error } = await sellerA
      .from('products')
      .update({ title: 'HACKED BY A', price: 1 })
      .eq('id', ctx.prodB.id)
      .select('id');
    let denied = !!error || (data ?? []).length === 0;
    const { data: after } = await admin
      .from('products')
      .select('title, price')
      .eq('id', ctx.prodB.id)
      .single();
    let detail = error ? `${error.message} (${error.code})` : `updated ${(data ?? []).length} row(s)`;
    if (after?.title !== ctx.prodB.title || Number(after?.price) !== Number(ctx.prodB.price)) {
      denied = false;
      detail += ' — DATA CHANGED';
    }
    record(2, "seller A edits seller B's product", denied, detail);
  }

  // ---- 3. insert a product under seller B's shop -------------------
  {
    const { error } = await sellerA.from('products').insert({
      shop_id: ctx.shopB,
      platform_category_id: ctx.category,
      title: 'planted by A',
      description: 'should never exist',
      price: 999,
    });
    let denied = !!error;
    let detail = error ? `${error.message} (${error.code})` : 'INSERT SUCCEEDED';
    const { count } = await admin
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', ctx.shopB)
      .eq('title', 'planted by A');
    if (count) {
      denied = false;
      detail += ' — ROW EXISTS';
    }
    record(3, "seller A inserts a product under seller B's shop", denied, detail);
  }

  // ---- 4. make itself an admin ------------------------------------
  {
    const { error } = await sellerA
      .from('admins')
      .insert({ user_id: ctx.a.id, role: 'superadmin' });
    let denied = !!error;
    let detail = error ? `${error.message} (${error.code})` : 'INSERT SUCCEEDED';
    const { count } = await admin
      .from('admins')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', ctx.a.id);
    if (count) {
      denied = false;
      detail += ' — IS NOW ADMIN';
    }
    record(4, 'seller A makes itself an admin', denied, detail);
  }

  // ---- 5. extend its own subscription expiry ----------------------
  {
    const { data: before } = await admin
      .from('subscriptions')
      .select('expires_at')
      .eq('shop_id', ctx.shopA)
      .single();

    const { data, error } = await sellerA
      .from('subscriptions')
      .update({
        expires_at: new Date(Date.now() + 10 * 365 * 864e5).toISOString(),
        plan: 'year_1',
        status: 'active',
      })
      .eq('shop_id', ctx.shopA)
      .select('shop_id');

    let denied = !!error || (data ?? []).length === 0;
    let detail = error ? `${error.message} (${error.code})` : `updated ${(data ?? []).length} row(s)`;

    const { data: after } = await admin
      .from('subscriptions')
      .select('expires_at')
      .eq('shop_id', ctx.shopA)
      .single();
    if (after?.expires_at !== before?.expires_at) {
      denied = false;
      detail += ' — EXPIRY CHANGED';
    }
    record(5, 'seller A extends its own expiry', denied, detail);
  }

  await sellerA.auth.signOut();
  await teardown();
}

try {
  await run();
} catch (err) {
  await teardown().catch(() => {});
  console.error('test harness failed:', err.message ?? err);
  process.exit(2);
}

let failed = 0;
console.log('\nAll five must be DENIED.\n');
for (const r of results) {
  const mark = r.denied ? 'DENIED  ✓' : 'ALLOWED ✗';
  if (!r.denied) failed += 1;
  console.log(`  ${r.n}. ${mark}  ${r.name}\n       ${r.detail}`);
}
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} correctly denied.\n`
    : `\n${failed} of ${results.length} were NOT denied — the database is not safe.\n`,
);
process.exit(failed === 0 ? 0 : 1);
