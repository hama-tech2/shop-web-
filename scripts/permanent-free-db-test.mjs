import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { databaseFixture } from './database-fixture.mjs';

const HISTORY_END = '20260927090000_two_months_free.sql';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const forward = readdirSync(migrations).filter((f) => f > HISTORY_END && f <= '20261013205746_permanent_free_subscription.sql' && f.endsWith('.sql'));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const productId = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actors = { trial: 1, paid: 2, month: 3, lapsed: 4, grace: 5,
  scheduled: 6, suspended: 7, banned: 8, subSuspended: 9, legacy: 10, none: 11,
  missing: 12, newcomer: 13, other: 14, ceiling: 15 };
const shopId = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function claims(db, role, actor = null) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ role, ...(actor ? { sub: id(actor) } : {}) })]);
}
async function scalar(db, sql, args = []) { return Object.values((await db.query(sql, args)).rows[0])[0]; }
async function denied(db, sql, args, code) {
  await db.exec('savepoint denial');
  await assert.rejects(db.query(sql, args), (error) => error.code === code);
  await db.exec('rollback to savepoint denial; release savepoint denial');
}
async function insertProduct(db, shop, n, status = 'active', extra = {}) {
  await db.query(`insert into public.products
    (id, shop_id, title, price, description, status, visibility, sort_order, created_at)
    values ($1, $2, 'Synthetic product', 1000, 'Synthetic fixture only', $3, $4, $5, $6)`,
  [productId(n), shopId(shop), status, extra.visibility ?? 'everyone',
    extra.sort ?? n, extra.created ?? '2026-01-01T00:00:00Z']);
}
async function createShop(db, n) {
  await db.query(`insert into public.shops(id, owner_id, slug, name, whatsapp)
    values ($1,$2,$3,'Synthetic shop','+9647000000000')`, [shopId(n), id(n), `fixture-${n}`]);
}
async function snapshot(db) {
  const tables = (await db.query(`select table_schema, table_name from information_schema.tables
    where table_schema in ('public','auth') and table_type='BASE TABLE'
    order by table_schema,table_name`)).rows;
  const out = {};
  for (const table of tables) {
    const name = `${table.table_schema}.${table.table_name}`;
    // The new metadata column has no predecessor; every original field is compared.
    out[name] = (await db.query(`select to_jsonb(t) - 'paid_starts_at' as row from ${name} t`))
      .rows.map((r) => JSON.stringify(r.row)).sort();
  }
  return out;
}
async function paymentBoundary(db) {
  return (await db.query(`select n.nspname, p.proname, pg_get_functiondef(p.oid) as definition,
    p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app','public') and
      (p.proname like 'wayl_%' or p.proname in
        ('plan_price','plan_price_for','set_intent_price','admin_grant_plan','admin_activate_intent',
         'is_admin','is_service_role','enforce_image_limit','save_product_images'))
    order by n.nspname,p.proname,p.oid`)).rows;
}

test('historical migrations replay unchanged in isolated PostgreSQL', async () => {
  const db = await databaseFixture({ through: HISTORY_END });
  try {
    assert.equal((await db.query('select app.free_product_limit() as n')).rows[0].n, 30);
  } finally { await db.close(); }
});

test('new migration rolls back definitions and schema atomically after an injected failure', async () => {
  const db = await databaseFixture({ through: HISTORY_END });
  try {
    const before=await paymentBoundary(db);
    const sql=readFileSync(new URL(forward[0],migrations),'utf8');
    await assert.rejects(db.exec(sql.replace(/commit;\s*$/i,'select 1/0; commit;')),
      (error)=>error.code==='22012');
    await db.exec('rollback');
    assert.equal(await scalar(db,'select app.free_product_limit()'),30);
    assert.equal(await scalar(db,`select count(*)::int from information_schema.columns
      where table_schema='public' and table_name='subscriptions' and column_name='paid_starts_at'`),0);
    assert.equal(await scalar(db,"select to_regprocedure('app.paid_public_entitlement(uuid)')"),null);
    assert.deepEqual(await paymentBoundary(db),before);
  } finally { await db.close(); }
});

test('historical five-product predecessor migration and PostgreSQL/RLS regression', async (t) => {
  assert.equal(forward.length, 1, 'one new forward-only migration');
  const db = await databaseFixture({ through: HISTORY_END });
  t.after(() => db.close());
  for (const n of Object.values(actors)) await db.query('insert into auth.users(id) values ($1)', [id(n)]);
  for (const n of Object.values(actors).filter((n) => n <= 12)) await createShop(db, n);
  for (const n of [3,4,5,6,7,8,9]) {
    await db.query(`update public.subscriptions set plan=$2,status='active',
      expires_at=now()+make_interval(months=>case $2 when 'month_1' then 1 else 6 end),
      trial_ends_at=null where shop_id=$1`,
    [shopId(n), n === 3 ? 'month_1' : 'months_6']);
  }
  // Complimentary six months uses the actual audited grant/activation path.
  await db.query("update public.subscriptions set expires_at=now(),trial_ends_at=null where shop_id=$1",[shopId(2)]);
  await db.query('insert into public.admins(user_id) values ($1)', [id(14)]);
  await db.exec('begin');
  await claims(db, 'authenticated', 14);
  await db.query('select public.admin_grant_plan($1,$2,$3,$4)',
    [shopId(2),'months_6','Synthetic complimentary entitlement',id(200)]);
  await db.exec('commit');
  for (const n of [4,5,6]) {
    for (let i=0; i<10; i++) {
      await insertProduct(db,n,n*100+i,i === 8 ? 'hidden' : i === 9 ? 'archived' : 'active',
        { visibility: i === 0 ? 'profile' : 'everyone', sort: 0 });
      await db.query(`insert into public.product_images(product_id,shop_id,r2_key,position)
        values ($1,$2,$3,1)`, [productId(n*100+i),shopId(n),`products/${shopId(n)}/${productId(n*100+i)}/card.webp`]);
    }
  }
  await db.query("update public.subscriptions set expires_at=now()-interval '5 days' where shop_id=$1", [shopId(4)]);
  await db.query("update public.subscriptions set expires_at=now()-interval '1 day',grace_days=3 where shop_id=$1", [shopId(5)]);
  await db.query(`update public.subscriptions set trial_ends_at=now()+interval '20 days',
    expires_at=now()+interval '20 days 6 months' where shop_id=$1`, [shopId(6)]);
  await db.query("update public.shops set status='suspended' where id=$1", [shopId(7)]);
  await db.query("update public.shops set status='banned' where id=$1", [shopId(8)]);
  await db.query("update public.subscriptions set status='suspended' where shop_id=$1", [shopId(9)]);
  await db.query("update public.subscriptions set plan='free',status='free' where shop_id=$1", [shopId(10)]);
  await db.query("update public.subscriptions set plan='none',status='none' where shop_id=$1", [shopId(11)]);
  await db.query('delete from public.subscriptions where shop_id=$1', [shopId(12)]);
  const before = await snapshot(db);
  const paymentBefore = await paymentBoundary(db);
  const authoritySql=`select proacl::text as acl,prosecdef,proconfig from pg_proc
    where oid='public.admin_apply_payment(uuid,text,numeric,text,text,text)'::regprocedure`;
  const authorityBefore=(await db.query(authoritySql)).rows;
  const originalSubscriptions = (await db.query('select * from public.subscriptions order by shop_id')).rows;
  await db.exec(readFileSync(new URL(forward[0],migrations),'utf8'));

  await t.test('migration preserves every original field/row, including audit, paid, trial and image history', async () => {
    assert.deepEqual(await snapshot(db),before);
    const unchanged = rows => rows.filter(row => !['wayl_start_intent','wayl_apply_payment','save_product_images','enforce_image_limit'].includes(row.proname));
    assert.deepEqual(unchanged(await paymentBoundary(db)),unchanged(paymentBefore));
    const current = await paymentBoundary(db);
    for (const name of ['wayl_start_intent','wayl_apply_payment','save_product_images','enforce_image_limit']) {
      assert.equal(current.find(r=>r.proname===name).acl,paymentBefore.find(r=>r.proname===name).acl);
      assert.match(current.find(r=>r.proname===name).definition,/lock_owned_subscription|for update/);
    }
    assert.deepEqual((await db.query(authoritySql)).rows,authorityBefore);
  });
  async function scenario(name, fn) {
    await t.test(name, async () => {
      await db.exec('begin');
      try { await fn(); } finally { await db.exec('rollback'); }
    });
  }
  const state = async (n) => (await db.query('select * from public.subscription_state($1)',[shopId(n)])).rows[0];
  const countProducts = async (n) => scalar(db,'select count(*)::int from public.products where shop_id=$1',[shopId(n)]);
  await scenario('new shop gets permanent Free without an expiry or new trial grant', async () => {
    await claims(db,'authenticated',13);
    await createShop(db,13);
    const s=await state(13);
    assert.equal(s.plan,'free'); assert.equal(s.status,'free'); assert.equal(s.tier,'free');
    assert.equal(s.expires_at,null); assert.equal(s.days_left,null); assert.equal(s.slots_left,5);
    assert.equal(s.publicly_visible,true); assert.equal(s.can_publish,true); assert.equal(s.on_trial,false);
    assert.equal(await scalar(db,'select expires_at from public.subscriptions where shop_id=$1',[shopId(13)]),null);
    await db.exec('reset role');
    assert.equal(await scalar(db,'select count(*)::int from public.trial_grants where user_id=$1',[id(13)]),0);
    assert.equal(await scalar(db,"select app.subscription_visible('free','1900-01-01',3)"),true);
  });
  await scenario('five stored rows include hidden/archived/profile; sixth blocked; deletion releases a slot', async () => {
    await claims(db,'authenticated',1);
    for (let i=0;i<5;i++) await insertProduct(db,1,100+i,i === 3 ? 'hidden' : i === 4 ? 'archived' : 'active',
      { visibility: i === 0 ? 'profile' : 'everyone' });
    assert.equal((await state(1)).slots_left,0);
    await denied(db,`insert into public.products(shop_id,title,price) values ($1,'Synthetic sixth',1000)`,[shopId(1)],'SW001');
    await db.query("update public.products set status='hidden' where id=$1",[productId(100)]);
    assert.equal((await state(1)).slots_left,0);
    await db.query('delete from public.products where id=$1',[productId(100)]);
    assert.equal((await state(1)).slots_left,1);
    await insertProduct(db,1,105);
    assert.equal(await countProducts(1),5);
  });
  await scenario('five images, sixth row and gallery refused, existing gallery can be re-saved/reordered', async () => {
    await claims(db,'authenticated',1); await insertProduct(db,1,110);
    const images=Array.from({length:5},(_,i)=>({card:`products/${shopId(1)}/${productId(110)}/${i}.webp`,full:null}));
    await db.query('select public.save_product_images($1,$2::jsonb)',[productId(110),JSON.stringify(images)]);
    await db.query('select public.save_product_images($1,$2::jsonb)',[productId(110),JSON.stringify(images.slice().reverse())]);
    await denied(db,'select public.save_product_images($1,$2::jsonb)',
      [productId(110),JSON.stringify([...images,{card:`products/${shopId(1)}/${productId(110)}/six.webp`}])],'23514');
    await denied(db,`insert into public.product_images(product_id,shop_id,r2_key,position) values ($1,$2,$3,6)`,
      [productId(110),shopId(1),`products/${shopId(1)}/${productId(110)}/six.webp`],'23514');
    assert.equal(await scalar(db,'select count(*)::int from public.product_images where product_id=$1',[productId(110)]),5);
  });
  await scenario('expired paid shop retains all ten products/images; deterministic five shared by public readers', async () => {
    const expected=Array.from({length:5},(_,i)=>productId(400+i));
    await claims(db,'anon');
    const publicIds=(await db.query('select id from public.products where shop_id=$1 order by id',[shopId(4)])).rows.map(r=>r.id);
    assert.deepEqual(publicIds,expected); assert.equal(await countProducts(4),5);
    assert.equal(await scalar(db,'select count(*)::int from public.product_images where shop_id=$1',[shopId(4)]),5);
    assert.equal(await scalar(db,'select app.shop_is_public($1)',[shopId(4)]),true);
    await claims(db,'authenticated',13);
    assert.equal(await countProducts(4),5);
    await claims(db,'authenticated',4);
    assert.equal(await countProducts(4),10);
    assert.equal((await state(4)).tier,'free'); assert.equal((await state(4)).expires_at,null);
    await db.query("update public.products set title='Edited retained product', visibility='profile' where id=$1",[productId(407)]);
    await denied(db,`insert into public.products(shop_id,title,price) values ($1,'Extra retained row',1000)`,[shopId(4)],'SW001');
  });
  await scenario('public search, direct eligibility, image reads and Home filtering share the whole-shop five', async () => {
    await claims(db,'anon');
    assert.equal((await db.query("select * from public.search_products('', $1,null,100,0)",[shopId(4)])).rows.length,5);
    assert.equal(await scalar(db,'select app.product_is_public($1)',[productId(406)]),false);
    assert.equal(await scalar(db,'select count(*)::int from public.product_images where product_id=$1',[productId(406)]),0);
    assert.equal(await scalar(db,"select count(*)::int from public.products where shop_id=$1 and visibility='everyone'",[shopId(4)]),4);
    assert.equal(await scalar(db,"select count(*)::int from public.shop_public_profile('fixture-4')"),1);
  });
  await scenario('paid grace remains public and uses the stored grace days, then falls back without cron', async () => {
    await claims(db,'anon'); assert.equal(await countProducts(5),8);
    await claims(db,'authenticated',5);
    const s=await state(5); assert.equal(s.tier,'free'); assert.equal(s.in_grace,true);
    assert.equal(s.publicly_visible,true); assert.equal(s.can_publish,false);
    await db.exec('reset role');
    await db.query("update public.subscriptions set expires_at=now()-interval '4 days' where shop_id=$1",[shopId(5)]);
    await claims(db,'anon'); assert.equal(await countProducts(5),5);
  });
  await scenario('non-default paid grace is preserved and the exact grace-end boundary uses Free visibility', async () => {
    await db.query("update public.subscriptions set expires_at=now()-interval '4 days',grace_days=7 where shop_id=$1",[shopId(5)]);
    await claims(db,'anon'); assert.equal(await countProducts(5),8);
    await db.exec('reset role');
    await db.query("update public.subscriptions set expires_at=now()-interval '7 days' where shop_id=$1",[shopId(5)]);
    await claims(db,'anon'); assert.equal(await countProducts(5),5);
  });
  await scenario('seller chooses public candidates without losing visibility preferences; upgrade restores eligible active rows', async () => {
    await claims(db,'authenticated',4);
    await db.query("update public.products set status='hidden' where id=$1",[productId(400)]);
    await claims(db,'anon');
    assert.equal(await scalar(db,'select count(*)::int from public.products where id=$1',[productId(405)]),1);
    await claims(db,'service_role');
    await db.query('select public.admin_apply_payment($1,$2,5000,$3,$4,$5)',
      [shopId(4),'months_6','wayl','FIXTURE-UPGRADE','Synthetic upgrade']);
    await claims(db,'anon'); assert.equal(await countProducts(4),7);
    await claims(db,'authenticated',4);
    assert.equal(await countProducts(4),10);
    assert.equal(await scalar(db,'select count(*)::int from public.product_images where shop_id=$1',[shopId(4)]),10);
    assert.equal(await scalar(db,'select status from public.products where id=$1',[productId(400)]),'hidden');
    assert.equal(await scalar(db,'select status from public.products where id=$1',[productId(409)]),'archived');
    assert.equal(await scalar(db,'select visibility from public.products where id=$1',[productId(400)]),'profile');
  });
  await scenario('complimentary six-month and historical one-month entitlements/dates are unchanged', async () => {
    for(const n of [2,3]) {
      await claims(db,'authenticated',n); const s=await state(n);
      const original=originalSubscriptions.find(r=>r.shop_id===shopId(n));
      assert.equal(s.tier,'paid'); assert.equal(s.plan,original.plan);
      assert.deepEqual(s.expires_at,original.expires_at);
      assert.equal(await scalar(db,'select grace_days from public.subscriptions where shop_id=$1',[shopId(n)]),original.grace_days);
    }
    await db.exec('reset role');
    const payment=(await db.query('select * from public.payments where shop_id=$1',[shopId(2)])).rows[0];
    assert.equal(payment.months_added,6); assert.equal(payment.method,'manual_grant');
    assert.equal(Number(payment.amount),0);
  });
  await scenario('an expired historical one-month plan remains recorded and returns to effective Free', async () => {
    await db.query("update public.subscriptions set expires_at=now()-interval '5 days' where shop_id=$1",[shopId(3)]);
    await claims(db,'authenticated',3);
    const s=await state(3); assert.equal(s.tier,'free'); assert.equal(s.expires_at,null); assert.equal(s.publicly_visible,true);
    assert.equal(await scalar(db,'select plan from public.subscriptions where shop_id=$1',[shopId(3)]),'month_1');
  });
  await scenario('existing scheduled paid entitlement keeps its dates and anti-stacking; paid limits begin at original start', async () => {
    await claims(db,'authenticated',6); const s=await state(6);
    assert.equal(s.paid_scheduled,true); assert.equal(s.tier,'free');
    assert.deepEqual(s.expires_at,originalSubscriptions.find(r=>r.shop_id===shopId(6)).expires_at);
    await denied(db,'select * from public.wayl_start_intent($1,$2,$3,$4,$5)',
      [shopId(6),'months_6','FIXTURE-SCHEDULE','test','s'.repeat(64)],'SW008');
    await db.exec('reset role');
    await db.query("update public.subscriptions set paid_starts_at=now()-interval '1 day' where shop_id=$1",[shopId(6)]);
    await claims(db,'authenticated',6); assert.equal((await state(6)).tier,'paid');
  });
  await scenario('trial-only history becomes effective Free without resetting the record or ledger', async () => {
    await claims(db,'authenticated',1); const s=await state(1);
    assert.equal(s.tier,'free'); assert.equal(s.on_trial,false); assert.equal(s.expires_at,null);
    assert.equal(await scalar(db,'select status from public.subscriptions where shop_id=$1',[shopId(1)]),'trialing');
    await db.exec('reset role');
    assert.equal(await scalar(db,'select count(*)::int from public.trial_grants where user_id=$1',[id(1)]),1);
  });
  await scenario('new purchase starts now despite a retained future trial deadline; trial history and grace stay intact', async () => {
    const original=originalSubscriptions.find(r=>r.shop_id===shopId(1));
    await claims(db,'service_role');
    await db.query('select public.admin_apply_payment($1,$2,5000,$3,$4,null)',[shopId(1),'months_6','wayl','FIXTURE-START']);
    const row=(await db.query('select *, expires_at=now()+interval \'6 months\' as exact from public.subscriptions where shop_id=$1',[shopId(1)])).rows[0];
    assert.equal(row.exact,true); assert.deepEqual(row.trial_ends_at,original.trial_ends_at);
    assert.deepEqual(row.started_at,original.started_at);
    assert.equal(row.grace_days,original.grace_days);
    await claims(db,'authenticated',1); assert.equal((await state(1)).tier,'paid'); assert.equal((await state(1)).paid_scheduled,false);
  });
  await scenario('suspended/banned/subscription-suspended accounts cannot publish or be reactivated by a payment', async () => {
    for(const n of [7,8,9]) {
      await claims(db,'authenticated',n);
      const s=await state(n); assert.equal(s.tier,'restricted'); assert.equal(s.can_publish,false); assert.equal(s.publicly_visible,false);
      await denied(db,`insert into public.products(shop_id,title,price) values ($1,'Restricted product',1000)`,[shopId(n)],'SW005');
      await claims(db,'service_role');
      await denied(db,'select public.admin_apply_payment($1,$2,0,$3,null,null)',[shopId(n),'months_6','manual_grant'],'SW005');
    }
  });
  await scenario('expiry sweep preserves products, images, trial history, restrictions and original paid expiry/grace', async () => {
    const products=(await db.query('select * from public.products order by id')).rows;
    const images=(await db.query('select * from public.product_images order by id')).rows;
    const grants=(await db.query('select * from public.trial_grants order by user_id')).rows;
    await claims(db,'service_role'); assert.equal(await scalar(db,'select public.expire_lapsed_subscriptions()'),1);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select * from public.products order by id')).rows,products);
    assert.deepEqual((await db.query('select * from public.product_images order by id')).rows,images);
    assert.deepEqual((await db.query('select * from public.trial_grants order by user_id')).rows,grants);
    for(const original of originalSubscriptions) {
      const row=(await db.query('select * from public.subscriptions where shop_id=$1',[original.shop_id])).rows[0];
      assert.deepEqual(row.expires_at,original.expires_at); assert.equal(row.grace_days,original.grace_days);
      assert.equal(row.plan,original.plan);
    }
    assert.equal(await scalar(db,'select status from public.subscriptions where shop_id=$1',[shopId(9)]),'suspended');
  });
  await scenario('owners retain editing; strangers cannot write rows, plans, dates, images or admin authority', async () => {
    await claims(db,'authenticated',13);
    assert.equal((await db.query("update public.products set title='Attack' where id=$1 returning id",[productId(407)])).rows.length,0);
    await denied(db,`insert into public.products(shop_id,title,price) values ($1,'Wrong owner',1000)`,[shopId(1)],'42501');
    assert.equal((await db.query("update public.subscriptions set expires_at=now()+interval '10 years' where shop_id=$1 returning id",[shopId(1)])).rows.length,0);
    await denied(db,"insert into public.admins(user_id) values ($1)",[id(13)],'42501');
    await denied(db,'select * from public.wayl_apply_payment($1,$2,5000,null,null)',[id(900),'FIXTURE-NOAUTH'],'42501');
    await denied(db,'select public.admin_apply_payment($1,$2,0,$3,null,null)',
      [shopId(1),'months_6','manual_grant'],'42501');
  });
  await scenario('multi-row storage insert is atomic and the quota check holds the subscription-row lock', async () => {
    await claims(db,'authenticated',1);
    await denied(db,`insert into public.products(shop_id,title,price)
      select $1,'Synthetic bulk product',1000 from generate_series(1,6)`,[shopId(1)],'SW001');
    assert.equal(await countProducts(1),0);
    await insertProduct(db,1,120);
    assert.equal(await scalar(db,`select exists(select 1 from pg_locks
      where relation='public.subscriptions'::regclass and mode='RowShareLock' and granted)`),true);
    // This asserts a real held lock, not independent-session race correctness.
  });
  await scenario('invalid null paid expiry is rejected and anonymous callers cannot obtain private subscription state', async () => {
    await denied(db,"update public.subscriptions set expires_at=null where shop_id=$1",[shopId(2)],'23514');
    await claims(db,'anon');
    await denied(db,'select * from public.subscription_state($1)',[shopId(2)],'42501');
    await claims(db,'authenticated',13);
    assert.equal((await db.query('select * from public.subscription_state($1)',[shopId(2)])).rows.length,0);
  });
  await scenario('stranger cannot save or attach another shop\'s gallery', async () => {
    await claims(db,'authenticated',13);
    await denied(db,'select public.save_product_images($1,$2::jsonb)',
      [productId(400),JSON.stringify([{card:`products/${shopId(4)}/${productId(400)}/new.webp`}])],'42501');
    await denied(db,`insert into public.product_images(product_id,shop_id,r2_key,position)
      values ($1,$2,$3,2)`,[productId(400),shopId(4),`products/${shopId(4)}/${productId(400)}/new.webp`],'42501');
  });
  await scenario('a suspended or banned shop has no public header; a suspended subscription does not expose products', async () => {
    await claims(db,'anon');
    for(const n of [7,8]) {
      assert.equal(await scalar(db,'select count(*)::int from public.shop_public_profile($1)',[`fixture-${n}`]),0);
    }
    assert.equal(await scalar(db,'select app.shop_is_public($1)',[shopId(9)]),false);
    assert.equal(await scalar(db,"select app.subscription_visible('suspended',now(),3)"),false);
  });
  await scenario('paid hard ceiling remains 1000 products', async () => {
    await createShop(db,15);
    await db.query("update public.subscriptions set plan='months_6',status='active',expires_at=now()+interval '6 months' where shop_id=$1",[shopId(15)]);
    await claims(db,'authenticated',15);
    await db.query(`insert into public.products(shop_id,title,price)
      select $1,'Synthetic ceiling',1000 from generate_series(1,1000)`,[shopId(15)]);
    assert.equal(await countProducts(15),1000);
    await denied(db,`insert into public.products(shop_id,title,price) values ($1,'Beyond ceiling',1000)`,[shopId(15)],'23514');
  });
  await scenario('prices remain authoritative and public month checkout is refused', async () => {
    assert.equal(await scalar(db,"select app.plan_price('months_6')"),'5000');
    assert.equal(await scalar(db,"select app.plan_price('year_1')"),'9000');
    assert.equal(await scalar(db,"select app.plan_price('month_1')"),null);
    await claims(db,'authenticated',1);
    await denied(db,'select * from public.wayl_start_intent($1,$2,$3,$4,$5)',
      [shopId(1),'month_1','FIXTURE-MONTH','test','s'.repeat(64)],'22023');
  });
  await scenario('unchanged Wayl activation and event dedupe extend once and retain anti-stacking', async () => {
    await claims(db,'authenticated',1);
    const intent=(await db.query('select * from public.wayl_start_intent($1,$2,$3,$4,$5)',
      [shopId(1),'months_6','FIXTURE-ONCE','test','s'.repeat(64)])).rows[0];
    assert.equal(Number(intent.amount),5000);
    await claims(db,'service_role');
    await denied(db,'select * from public.wayl_apply_payment($1,$2,1,null,null)',[intent.id,'FIXTURE-ONCE'],'22023');
    await denied(db,'select * from public.wayl_apply_payment($1,$2,5000,null,null)',[intent.id,'FIXTURE-WRONG'],'22023');
    const apply=()=>db.query('select * from public.wayl_apply_payment($1,$2,5000,null,null)',[intent.id,'FIXTURE-ONCE']);
    assert.equal((await apply()).rows[0].activated,true);
    const expiry=await scalar(db,'select expires_at from public.subscriptions where shop_id=$1',[shopId(1)]);
    assert.equal((await apply()).rows[0].already_active,true);
    assert.deepEqual(await scalar(db,'select expires_at from public.subscriptions where shop_id=$1',[shopId(1)]),expiry);
    assert.equal(await scalar(db,'select count(*)::int from public.payments where shop_id=$1',[shopId(1)]),1);
    const event=()=>scalar(db,'select public.wayl_record_event($1,$2,null,null)',[intent.id,'FIXTURE-EVENT']);
    assert.equal(await event(),true); assert.equal(await event(),false);
    await claims(db,'authenticated',1);
    await denied(db,'select * from public.wayl_start_intent($1,$2,$3,$4,$5)',
      [shopId(1),'year_1','FIXTURE-STACK','test','s'.repeat(64)],'SW008');
  });
  await scenario('legacy demotion cannot overwrite seller preferences', async () => {
    await denied(db,'select app.demote_to_free_limit($1)',[shopId(4)],'SW009');
    await claims(db,'authenticated',4);
    await denied(db,'select app.demote_to_free_limit($1)',[shopId(4)],'42501');
  });
  await scenario('missing subscription fails closed; none/legacy Free stay permanently public', async () => {
    for(const n of [10,11]) {
      await claims(db,'authenticated',n); const s=await state(n);
      assert.equal(s.tier,'free'); assert.equal(s.expires_at,null); assert.equal(s.publicly_visible,true);
    }
    await claims(db,'authenticated',12); assert.equal(await state(12),undefined);
    assert.equal(await scalar(db,'select app.can_publish($1)',[shopId(12)]),false);
    await claims(db,'anon'); assert.equal(await scalar(db,'select app.shop_is_public($1)',[shopId(12)]),false);
  });
});
