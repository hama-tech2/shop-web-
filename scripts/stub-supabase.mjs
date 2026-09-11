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
import { GRANT_PLANS } from '../worker/config.js';

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
let subPlan = 'free';             // free | month_1 | months_6 | year_1
let suspended = false;            // the admin's stop button
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

/* ------------------------------------------------------------------
   Wayl: the hosted checkout, and the database rows behind it.

   The fake Wayl API lives here too, so no test can reach the real one
   and no test run can create a real charge. What the API reports is
   driven by /__wayl/* so a test can say "Wayl now says paid" without
   any timing.
   ------------------------------------------------------------------ */
const WAYL_INTENT_ID = 'eeeeeeee-2222-4222-8222-222222222222';
let waylIntent = null;              // the payment_intents row, Wayl columns and all
let waylSecret = null;              // payment_intent_secrets
let waylCreated = [];               // every create-link body the Worker sent
const waylEvents = new Set();       // wayl_webhook_events.event_id, which is unique
let waylReports = 'pending';        // what GET /api/v1/links/{ref} says
let waylMethod = 'FIB';
let waylTotal = null;               // override, to force an amount mismatch
let waylCurrency = 'IQD';
let waylLinkFails = false;
let waylBusy = false;               // the per-shop rate limit, tripped on demand
let waylActivations = 0;            // how many times a plan was actually granted
let waylExpiry = null;

function waylReset() {
  waylIntent = null; waylSecret = null; waylCreated = []; waylEvents.clear();
  waylReports = 'Created'; waylMethod = 'FIB'; waylTotal = null; waylCurrency = 'IQD';
  waylLinkFails = false; waylBusy = false; waylActivations = 0; waylExpiry = null;
}

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
  // The admin's stop button, which outranks any plan.
  if (p.startsWith('/__suspended/')) { suspended = p.split('/')[2] === '1'; return send({ suspended }); }
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

  // ---- Wayl controls -------------------------------------------------
  if (p === '/__wayl/reset') { waylReset(); return send({ reset: true }); }
  if (p.startsWith('/__wayl/reports/')) { waylReports = decodeURIComponent(p.split('/')[3]); return send({ waylReports }); }
  if (p.startsWith('/__wayl/method/')) { waylMethod = decodeURIComponent(p.split('/')[3]); return send({ waylMethod }); }
  if (p.startsWith('/__wayl/total/')) { waylTotal = Number(p.split('/')[3]); return send({ waylTotal }); }
  if (p.startsWith('/__wayl/currency/')) { waylCurrency = p.split('/')[3]; return send({ waylCurrency }); }
  if (p.startsWith('/__wayl/linkfails/')) { waylLinkFails = p.split('/')[3] === '1'; return send({ waylLinkFails }); }
  if (p.startsWith('/__wayl/busy/')) { waylBusy = p.split('/')[3] === '1'; return send({ waylBusy }); }
  if (p === '/__wayl') {
    return send({ intent: waylIntent, secret: waylSecret, created: waylCreated,
                  events: [...waylEvents], activations: waylActivations });
  }

  // ---- the fake Wayl API ---------------------------------------------
  // Only ever reached because WAYL_API_BASE points here. A test that
  // somehow reached api.thewayl.com would fail on the token instead.
  if (p === '/api/v1/links' && req.method === 'POST') {
    if (req.headers['x-wayl-authentication'] !== 'stub-wayl-token') {
      return send({ message: 'unauthenticated' }, 401);
    }
    waylCreated.push(lastBody);
    if (waylLinkFails) return send({ message: 'nope' }, 422);
    // The real API refuses any other lineItem shape, and did: label is
    // a string, amount a number, type "increase" or "decrease".
    const line = Array.isArray(lastBody.lineItem) ? lastBody.lineItem[0] : null;
    if (typeof line?.label !== 'string' || typeof line?.amount !== 'number'
        || !['increase', 'decrease'].includes(line?.type)) {
      return send({ success: false, message: 'Whoops, missing fields' }, 422);
    }
    // The real envelope: { data, message, success }, with total as a
    // string and status "Created" at this point.
    return send({ data: {
      env: lastBody.env, customParameter: lastBody.customParameter,
      referenceId: lastBody.referenceId, id: 'lnk_1', code: 'CODE1',
      total: String(lastBody.total), currency: lastBody.currency,
      paymentMethod: null, status: 'Created', completedAt: null,
      url: 'https://checkout.thewayl.test/pay/' + lastBody.referenceId,
      redirectionUrl: lastBody.redirectionUrl, linkExpiresIn: '1h',
    }, message: 'Done', success: true });
  }
  const waylLink = p.match(/^\/api\/v1\/links\/(.+)$/);
  if (waylLink && req.method === 'GET') {
    if (req.headers['x-wayl-authentication'] !== 'stub-wayl-token') {
      return send({ message: 'unauthenticated' }, 401);
    }
    const reference = decodeURIComponent(waylLink[1]);
    if (!waylIntent || waylIntent.reference_id !== reference) return send({ message: 'not found' }, 404);
    return send({ data: {
      referenceId: reference,
      status: waylReports,
      paymentMethod: waylMethod,
      total: waylTotal === null ? Number(waylIntent.amount) : waylTotal,
      currency: waylCurrency,
    } });
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

  if (table === 'payment_intent_secrets') {
    const wanted = (url.searchParams.get('intent_id') || '').slice(3);
    return send(waylSecret && waylIntent && waylIntent.id === wanted
      ? [{ webhook_secret: waylSecret }] : []);
  }

  if (table === 'payment_intents') {
    // The Wayl reads: by reference for the seller, by id for the webhook.
    if (!write && (url.searchParams.has('reference_id') || url.searchParams.has('id'))) {
      const byRef = (url.searchParams.get('reference_id') || '').slice(3);
      const byId = (url.searchParams.get('id') || '').slice(3);
      const shop = (url.searchParams.get('shop_id') || '').slice(3);
      if (!waylIntent) return send([]);
      if (byRef && waylIntent.reference_id !== decodeURIComponent(byRef)) return send([]);
      if (byId && waylIntent.id !== byId) return send([]);
      if (shop && waylIntent.shop_id !== shop) return send([]);
      return send([waylIntent]);
    }
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
    // Since 0030 a seller has no insert policy on this table: every
    // intent is made by public.wayl_start_intent or by an admin grant.
    // PostgREST answers an RLS refusal, and so does this.
    if (req.method === 'POST' && !isAdmin) {
      return send({ code: '42501', message: 'new row violates row-level security policy' }, 403);
    }
    // An admin grant still files one, the way admin_grant_plan does.
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
    // app.enforce_free_product_limit: suspension first, then the count,
    // and nothing to count on a paid plan.
    if (write && req.method === 'POST' && suspended) {
      return send({ code: 'SW005', message: 'shop is suspended' }, 400);
    }
    if (write && req.method === 'POST'
        && !(['month_1', 'months_6', 'year_1'].includes(subPlan) && subDays > 0)
        && productCount >= 5) {
      return send({ code: 'SW001', message: 'free plan allows 5 products' }, 400);
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
    // The row as it is stored. A paid plan whose date has passed still
    // says year_1/active until expire_lapsed_subscriptions() sweeps it,
    // which is what lets the account card draw grace and then expired.
    // /__plan/free is the swept state.
    const sold = ['month_1', 'months_6', 'year_1'].includes(subPlan);
    const expires = new Date(Date.now() + subDays * 86400000).toISOString();
    // Grace is 3 days, matching subscriptions.grace_days.
    const graceEnds = new Date(Date.now() + (subDays + 3) * 86400000).toISOString();
    // app.plan_tier: only a sold plan whose date has not passed.
    const paid = sold && subDays > 0;
    return send([{
      plan: subPlan,
      status: suspended ? 'suspended' : sold ? 'active' : 'free',
      started_at: new Date(Date.now() - 10 * 86400000).toISOString(),
      expires_at: sold ? expires : new Date().toISOString(),
      grace_ends_at: sold ? graceEnds : new Date().toISOString(),
      days_left: sold ? Math.max(0, Math.ceil(subDays)) : 0,
      total_days: 30,
      in_grace: sold && subDays <= 0 && subDays > -3,
      // A Free shop is a public shop; that is the whole point of it.
      publicly_visible: !suspended && (!sold || subDays > -3),
      // app.can_publish: not suspended, and either paid or holding a slot.
      can_publish: !suspended && (paid || productCount < 5),
      tier: paid ? 'paid' : 'free',
      slots_left: paid ? null : Math.max(0, 5 - productCount),
    }]);
  }
  // Null on a paid plan means unlimited, which is what the app checks.
  if (table === 'rpc/product_slots_left') {
    const paidNow = ['month_1', 'months_6', 'year_1'].includes(subPlan) && subDays > 0;
    return send(paidNow ? null : Math.max(0, 5 - productCount));
  }
  if (table === 'rpc/admin_grant_plan' && !GRANT_PLANS.includes(lastBody.p_plan)) {
    return send({ code: '22023' }, 400);
  }
  // app.owns_shop, the price trigger, the rate limit and the one-live
  // intent rule, as far as the Worker can tell them apart.
  if (table === 'rpc/wayl_start_intent') {
    if (lastBody.p_shop !== SHOP.id) return send({ code: '42501' }, 403);
    // app.wayl_start_intent's per-shop rate limit, on demand.
    if (waylBusy) return send({ code: 'SW002' }, 400);
    if (!['months_6', 'year_1'].includes(lastBody.p_plan)) return send({ code: '22023' }, 400);
    if (intent && intent.status === 'pending' && intent.plan === lastBody.p_plan) {
      return send({ code: 'SW003' }, 400);
    }
    if (waylIntent && waylIntent.status === 'open' && waylIntent.checkout_url
        && waylIntent.plan === lastBody.p_plan) {
      return send([{ ...waylIntent, reused: true }]);
    }
    waylIntent = {
      id: WAYL_INTENT_ID, shop_id: SHOP.id, user_id: USER.id, plan: lastBody.p_plan,
      // The price is the database's, never the caller's.
      amount: lastBody.p_plan === 'year_1' ? 90000 : 55000, currency: 'IQD',
      status: 'open', reference_id: lastBody.p_reference_id, reference: 'SW-4822',
      wayl_link_id: null, wayl_code: null, checkout_url: null, env: lastBody.p_env,
      payment_method: null, paid_at: null, activated_at: null,
      created_at: new Date().toISOString(),
    };
    waylSecret = lastBody.p_secret;
    return send([{ ...waylIntent, reused: false }]);
  }
  if (table === 'rpc/wayl_attach_link') {
    if (!waylIntent || waylIntent.id !== lastBody.p_intent) return send({ code: 'P0002' }, 400);
    if (waylIntent.status !== 'open') return send({ code: '22023' }, 400);
    waylIntent = { ...waylIntent, wayl_link_id: lastBody.p_link_id,
                   wayl_code: lastBody.p_code, checkout_url: lastBody.p_url };
    return send(waylIntent);
  }
  if (table === 'rpc/wayl_apply_payment') {
    // Only the service key ever reaches this, and every refusal below
    // is one the real function makes too.
    if (!(req.headers.authorization || '').includes(SERVICE_KEY)) return send({ code: '42501' }, 403);
    if (!waylIntent || waylIntent.id !== lastBody.p_intent) return send({ code: 'P0002' }, 400);
    if (waylIntent.reference_id !== lastBody.p_reference_id) return send({ code: '22023' }, 400);
    const price = waylIntent.plan === 'year_1' ? 90000 : 55000;
    if (Number(lastBody.p_amount) !== price) return send({ code: '22023' }, 400);
    if (waylIntent.activated_at) {
      return send([{ activated: false, already_active: true, expires_at: waylExpiry }]);
    }
    waylActivations += 1;
    waylExpiry = new Date(Date.now() + (waylIntent.plan === 'year_1' ? 365 : 182) * 86400000).toISOString();
    subPlan = waylIntent.plan;
    subDays = waylIntent.plan === 'year_1' ? 365 : 182;
    waylIntent = { ...waylIntent, status: 'paid', paid_at: new Date().toISOString(),
                   activated_at: new Date().toISOString(),
                   payment_method: lastBody.p_method ?? waylIntent.payment_method };
    return send([{ activated: true, already_active: false, expires_at: waylExpiry }]);
  }
  if (table === 'rpc/wayl_record_event') {
    if (!(req.headers.authorization || '').includes(SERVICE_KEY)) return send({ code: '42501' }, 403);
    if (waylEvents.has(lastBody.p_event_id)) return send(false);
    waylEvents.add(lastBody.p_event_id);
    return send(true);
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
