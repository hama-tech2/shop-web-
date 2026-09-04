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

let rows = 1;                     // how many rows a write reports
let mode = 'shop';                // shop | noshop
const calls = [];

const body = (req) => new Promise((r) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b));
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  await body(req);

  const send = (data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  if (p.startsWith('/__rows/')) { rows = Number(p.split('/')[2]); return send({ rows }); }
  if (p.startsWith('/__mode/')) { mode = p.split('/')[2]; return send({ mode }); }
  if (p === '/__calls') return send(calls);

  if (p === '/auth/v1/user') return send(USER);

  const table = p.replace('/rest/v1/', '');
  const write = req.method !== 'GET';
  if (write) calls.push(`${req.method} ${table}?${url.searchParams}`);

  if (table === 'shops') {
    const owner = url.searchParams.get('owner_id') || '';

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
    // A write reports back exactly `rows` affected rows.
    return send(rows ? [{ id: CAT_A, name: 'x', sort_order: 10 }] : []);
  }

  if (table === 'products') {
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
  if (table.startsWith('rpc/')) return send(null);
  return send([]);
}).listen(8899, '127.0.0.1', () => console.log('stub on 8899'));
