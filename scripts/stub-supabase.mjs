/**
 * Shop Web — a stand-in for Supabase Auth + PostgREST.
 *
 * Lets the real Worker run the seller write paths with no network, so
 * a test can drive them end to end rather than mocking the route.
 *
 * GET /__rows/0 or /__rows/1 switches how many rows every write reports
 * as affected — the thing scripts/affected-rows-test.mjs is checking.
 * GET /__calls returns every write the Worker made, so a test can also
 * assert the filters it sent.
 *
 *   node scripts/stub-supabase.mjs
 *   printf 'SUPABASE_URL="http://127.0.0.1:8899"\nSUPABASE_PUBLISHABLE_KEY="stub"\n' > .dev.vars
 *   npx wrangler dev --port 8798 --local
 *   npm run test:affected
 *
 * Delete .dev.vars afterwards — it points the app at the stub.
 */
import http from 'node:http';

const SHOP = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  slug: 'nafin-boutique', name: 'بۆتیکی نافین', logo_key: null,
  city: 'erbil', whatsapp: '+9647510000002', status: 'active',
};
const USER = { id: 'ffffffff-1111-4111-8111-111111111111', email: 's@x.test' };
const PRODUCT_ID = 'bbbbbbbb-1111-4111-8111-111111111111';

/** A public shop owned by someone else — what RLS leaks without a filter. */
const FOREIGN_SHOP = {
  id: '99999999-9999-4999-8999-999999999999',
  slug: 'nafin-boutique', name: 'بۆتیکی نافین', logo_key: null,
  city: 'erbil', whatsapp: '+9647510000002', status: 'active',
};
const CAT_A = 'dddddddd-1111-4111-8111-111111111111';
const CAT_B = 'dddddddd-2222-4222-8222-222222222222';
/** The id an insert comes back with — nothing the client could guess. */
const CAT_NEW = 'dddddddd-3333-4333-8333-333333333333';

let rows = 1;                     // how many rows a write reports
let mode = 'shop';                // shop | noshop
let created = null;               // a shop made through onboarding
let isAdmin = false;              // does the session own an admins row
let adminActive = true;
const manualGrants = new Map();
let subDays = 20;                 // days until the subscription expires
let subPlan = 'trial';            // trial | months_6 | year_1
let productCount = 0;             // how many products the shop has
let dismissed = {};               // banner kind -> ISO timestamp
const telegram = [];              // every call the Worker made to the bot API
let nextMessageId = 500;
let telegramDown = false;
let intent = null;                // the shop's live payment intent
const INTENT_ID = 'eeeeeeee-1111-4111-8111-111111111111';
/** Stands in for the service_role key in .dev.vars. */
const SERVICE_KEY = 'stub-service-key';
const calls = [];
const writes = [];

let lastBody = {};
const body = (req) => new Promise((r) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b));
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const raw = await body(req);
  try { lastBody = raw ? JSON.parse(raw) : {}; } catch { lastBody = {}; }

  const send = (data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (p.startsWith('/__rows/')) { rows = Number(p.split('/')[2]); return send({ rows }); }
  if (p.startsWith('/__mode/')) { mode = p.split('/')[2]; created = null; return send({ mode }); }
  if (p === '/__created') return send(created ? [created] : []);
  if (p === '/__calls') return send(calls);
  // The bodies behind those calls: a test that cares WHAT was written —
  // that a stale category id never reached the insert, say — needs more
  // than the method and the table.
  if (p === '/__writes') return send(writes);
  // Lets a test say "from here on, which tables did the Worker write to?"
  if (p === '/__calls/reset') { calls.length = 0; writes.length = 0; return send([]); }
  // The seller-facing plan flow is all dates and one row, so the tests
  // drive both directly rather than trying to age a fixture.
  if (p.startsWith('/__admin/')) { isAdmin = p.split('/')[2] === '1'; return send({ isAdmin }); }
  if (p.startsWith('/__admin-active/')) { adminActive = p.split('/')[2] === '1'; return send({ adminActive }); }
  if (p.startsWith('/__sub/')) { subDays = Number(p.split('/')[2]); return send({ subDays }); }
  if (p.startsWith('/__plan/')) { subPlan = p.split('/')[2]; return send({ subPlan }); }
  if (p.startsWith('/__products/')) { productCount = Number(p.split('/')[2]); return send({ productCount }); }
  if (p.startsWith('/__dismissed/')) {
    const [, , kind, when] = p.split('/');
    if (kind === 'reset') dismissed = {};
    else dismissed[kind] = new Date(Date.now() - Number(when) * 86400000).toISOString();
    return send(dismissed);
  }
  if (p.startsWith('/__intent/')) {
    const want = p.split('/')[2];
    intent = want === 'none' ? null : {
      id: INTENT_ID, shop_id: SHOP.id, plan: 'months_6', amount: 55000,
      status: want, reference: 'SW-4821',
      created_at: new Date().toISOString(),
    };
    return send(intent ?? {});
  }

  // Standing in for api.telegram.org. Nothing in the tests may reach
  // the real bot API: TELEGRAM_API_BASE points here.
  const bot = p.match(/^\/bot([^/]+)\/(\w+)$/);
  if (bot) {
    telegram.push({ token: bot[1], method: bot[2], body: lastBody });
    if (telegramDown) { res.writeHead(502); return res.end('bad gateway'); }
    if (bot[2] === 'sendMessage') {
      return send({ ok: true, result: { message_id: nextMessageId++ } });
    }
    return send({ ok: true, result: true });
  }
  if (p === '/__telegram') return send(telegram);
  if (p === '/__telegram/reset') { telegram.length = 0; return send([]); }
  // Makes the bot API look unreachable, to prove a payment still lands.
  if (p === '/__telegram/down') { telegramDown = true; return send({ down: true }); }
  if (p === '/__telegram/up') { telegramDown = false; return send({ down: false }); }

  if (p === '/auth/v1/user') return send(USER);
  if (p === '/auth/v1/signup' || p.startsWith('/auth/v1/token')) {
    return send({ access_token: 'stub-token', refresh_token: 'stub-refresh',
                  expires_in: 3600, user: USER });
  }

  const table = p.replace('/rest/v1/', '');
  const write = req.method !== 'GET';
  if (write) {
    calls.push(`${req.method} ${table}?${url.searchParams}`);
    writes.push({ method: req.method, table, search: String(url.searchParams), body: lastBody });
  }

  if (table === 'shops' && req.method === 'POST') {
    // Onboarding's insert. Keep it so the next read finds it, exactly
    // as the database would.
    created = { ...SHOP, ...lastBody, id: SHOP.id, status: 'active' };
    return send([created]);
  }

  if (table === 'shops') {
    const owner = url.searchParams.get('owner_id') || '';
    if (mode === 'noshop' && created && owner === `eq.${USER.id}`) return send([created]);

    // Mirror Postgres + RLS, which is where the publish bug lived. The
    // SELECT policy is `owner_id = auth.uid() OR shop_is_public(id)`,
    // so an unfiltered `limit 1` hands back SOMEBODY ELSE'S public shop
    // when the caller owns none. Only an explicit owner_id filter makes
    // the answer empty. A stub that always returned [] here would let
    // that bug pass unnoticed.
    if (mode === 'noshop') {
      return send(owner === `eq.${USER.id}` ? [] : [FOREIGN_SHOP]);
    }
    if (owner && owner !== `eq.${USER.id}`) return send([]);
    return send([SHOP]);
  }
  // The admin gate reads this table with the caller's own token, so an
  // empty answer is exactly what a non-admin gets from RLS.
  if (table === 'admins') {
    return send(isAdmin && (adminActive || url.searchParams.get('is_active') !== 'eq.true')
      ? [{ user_id: USER.id, role: 'superadmin', is_active: adminActive }] : []);
  }
  if (table === 'subscriptions') return send([{ shop_id: SHOP.id, plan: subPlan,
    status: subPlan === 'trial' ? 'trialing' : 'active', grace_days: 3,
    expires_at: new Date(Date.now() + subDays * 86400000).toISOString() }]);

  if (table === 'payment_intents') {
    if (!write) {
      const wanted = url.searchParams.get('status') || '';
      if (!intent) return send([]);
      // `in.(open,pending)` and `eq.pending` are the two the app sends.
      const match = wanted.startsWith('in.')
        ? wanted.slice(4, -1).split(',').includes(intent.status)
        : wanted.startsWith('eq.')
          ? wanted.slice(3) === intent.status
          : true;
      return send(match ? [intent] : []);
    }
    // A PATCH updates the row it matched. Treating it as another insert
    // reset the status, which made a notification look like it had
    // undone the seller's own "I sent it".
    if (req.method === 'PATCH') {
      intent = { ...(intent ?? {}), ...lastBody };
      return send([intent]);
    }
    // The insert is where the database sets the price and the code; the
    // client never gets to name either.
    intent = {
      id: INTENT_ID, shop_id: SHOP.id, plan: lastBody.plan,
      amount: lastBody.plan === 'year_1' ? 90000 : 55000,
      status: 'open', reference: 'SW-4821',
      created_at: new Date().toISOString(),
    };
    return send([intent]);
  }

  if (table === 'plan_banner_dismissals') {
    if (!write) {
      return send(Object.entries(dismissed).map(([kind, at]) => ({ kind, dismissed_at: at })));
    }
    dismissed[lastBody.kind] = lastBody.dismissed_at ?? new Date().toISOString();
    return send([lastBody]);
  }

  if (table === 'payments') {
    if (url.searchParams.get('method') === 'eq.manual_grant') return send([...manualGrants.values()]);
    return send([
      { id: '11111111-1111-4111-8111-111111111111', plan: 'months_6',
        amount: 55000, status: 'confirmed', reference: 'SW-1234',
        paid_at: '2026-08-01T10:00:00Z', created_at: '2026-08-01T10:00:00Z' },
    ]);
  }

  if (table === 'platform_categories') {
    return send([{ id: 'cccccccc-1111-4111-8111-111111111111', slug: 'clothing', name_ckb: 'جل' }]);
  }

  if (table === 'categories') {
    if (!write) {
      return send([
        { id: CAT_A, name: 'کراس', sort_order: 10 },
        { id: CAT_B, name: 'عەتر', sort_order: 20 },
      ]);
    }
    // An insert comes back as the row Postgres would have made: a fresh
    // id and the name that was sent, which is what the inline creator in
    // the product form selects.
    if (req.method === 'POST') {
      return send([{ id: CAT_NEW, name: lastBody.name, sort_order: lastBody.sort_order ?? 30 }]);
    }
    // Every other write reports back exactly `rows` affected rows.
    return send(rows ? [{ id: CAT_A, name: lastBody.name ?? 'x', sort_order: 10 }] : []);
  }

  if (table === 'products') {
    // app.enforce_trial_product_limit raises SW001 once a trial shop is
    // full. Modelling it here is the point: the Worker checks first, but
    // the database is what actually refuses, and the route has to answer
    // that refusal with the message that links to the plans.
    if (write && req.method === 'POST' && subPlan === 'trial' && productCount >= 5) {
      return send({ code: 'SW001', message: 'trial product limit of 5 reached' }, 400);
    }
    // app.check_category_same_shop raises 23514 for a category_id that
    // does not exist or belongs to another shop. Modelling it here is
    // the point: without it a stale id looks harmless in a test and
    // still fails on a seller's phone.
    if (write && lastBody.category_id && ![CAT_A, CAT_B].includes(lastBody.category_id)) {
      return send({ code: '23514', message: 'category does not belong to this shop' }, 400);
    }
    if (!write) {
      return send([{
        id: PRODUCT_ID, title: 'کراسی کوردی', price: 85000, description: '',
        status: 'active', shop_id: SHOP.id, sort_order: 0,
        platform_category_id: null, category_id: null, product_images: [],
      }]);
    }
    return send(rows ? [{ id: PRODUCT_ID }] : []);
  }

  if (table === 'products' && req.method === 'POST') return send([{ id: PRODUCT_ID }]);
  if (table === 'rpc/shop_public_profile') {
    const slug = url.searchParams.get('p_slug') ?? lastBody.p_slug;
    if (String(slug).toLowerCase() !== SHOP.slug) return send([]);
    return send([{
      ...SHOP, bio: null, phone: null,
      instagram: null, tiktok: null, facebook: null, snapchat: 'nafin-shop',
      maps_url: 'https://maps.app.goo.gl/abc123',
      cover_key: null, products_visible: true,
    }]);
  }
  if (table === 'rpc/subscription_state') {
    const expires = new Date(Date.now() + subDays * 86400000).toISOString();
    // Grace is 3 days, matching subscriptions.grace_days.
    const graceEnds = new Date(Date.now() + (subDays + 3) * 86400000).toISOString();
    return send([{
      plan: subPlan, status: subPlan === 'trial' ? 'trialing' : 'active',
      started_at: new Date(Date.now() - 10 * 86400000).toISOString(),
      expires_at: expires, grace_ends_at: graceEnds,
      days_left: Math.max(0, Math.ceil(subDays)), total_days: 30,
      in_grace: subDays <= 0 && subDays > -3,
      publicly_visible: subDays > -3,
    }]);
  }
  // Null on a paid plan means unlimited, which is what the app checks.
  if (table === 'rpc/trial_slots_left') {
    return send(subPlan === 'trial' ? Math.max(0, 5 - productCount) : null);
  }
  if (table === 'rpc/mark_intent_sent') {
    if (!intent || intent.status !== 'open') return send({ code: '22023' }, 400);
    intent = { ...intent, status: 'pending' };
    return send(intent);
  }
  if (table === 'rpc/admin_open_intents') {
    if (!isAdmin) return send([]);
    return send(intent ? [{ ...intent, name: SHOP.name, slug: SHOP.slug,
                            whatsapp: SHOP.whatsapp }] : []);
  }
  if (table === 'rpc/admin_expiring_soon') {
    if (!isAdmin) return send([]);
    return send([{
      shop_id: SHOP.id, name: SHOP.name, slug: SHOP.slug, whatsapp: SHOP.whatsapp,
      plan: 'trial', status: 'trialing',
      expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      days_left: 3, in_grace: false,
    }]);
  }
  if (table === 'rpc/admin_activate_intent') {
    // The service key reaches these through app.is_service_role(); the
    // admin screen reaches them through app.is_admin(). Either is fine
    // here — what the tests care about is that a stranger cannot.
    const asService = (req.headers.authorization || '').includes(SERVICE_KEY);
    if (!isAdmin && !asService) return send({ code: '42501' }, 403);
    if (!intent || !['open', 'pending'].includes(intent.status)) {
      return send({ code: '22023' }, 400);
    }
    intent = { ...intent, status: 'paid' };
    return send({ id: 'p1', status: 'confirmed' });
  }
  if (table === 'rpc/admin_grant_plan') {
    if (!isAdmin || !adminActive) return send({ code: '42501' }, 403);
    if (!rows) return send({ code: 'XX000' }, 500);
    if (!manualGrants.has(lastBody.p_request)) manualGrants.set(lastBody.p_request, {
      id: lastBody.p_request, plan: lastBody.p_plan, method: 'manual_grant', amount: 0,
      note: lastBody.p_reason, recorded_by: USER.id, paid_at: new Date().toISOString(),
    });
    return send(manualGrants.get(lastBody.p_request));
  }
  if (table === 'rpc/admin_intent_not_found') {
    const asServiceNf = (req.headers.authorization || '').includes(SERVICE_KEY);
    if (!isAdmin && !asServiceNf) return send({ code: '42501' }, 403);
    if (!intent || intent.status !== 'pending') return send({ code: '22023' }, 400);
    intent = { ...intent, status: 'open' };
    return send(intent);
  }
  if (table === 'rpc/admin_stats') return send([{}]);
  if (table === 'rpc/admin_shops') {
    const q = String(lastBody.p_search || '').toLowerCase();
    return send(!q || [SHOP.name, SHOP.slug].some((s) => s.toLowerCase().includes(q))
      ? [{ ...SHOP, plan: subPlan, days_left: subDays, visible: subDays > -3, product_count: productCount }] : []);
  }
  if (table === 'rpc/slug_available') return send([{ available: true, reason: null }]);
  if (table.startsWith('rpc/')) return send(null);
  return send([]);
}).listen(8899, '127.0.0.1', () => console.log('stub on 8899'));
