import test from 'node:test';
import assert from 'node:assert/strict';
import { sitemapGet } from '../worker/routes/seo.js';
import { publicProductRefs } from '../worker/supabase.js';
import { databaseFixture } from './database-fixture.mjs';

const env = { SUPABASE_URL: 'https://synthetic.test', SUPABASE_PUBLISHABLE_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-used' };
const origin = 'https://bazarnow.xyz';
const shop = '40000000-0000-4000-8000-000000000001';
const id = n => '50000000-0000-4000-8000-' + String(n).padStart(12, '0');
const key = (n, suffix = 'full.webp') => `products/${shop}/${id(n)}/${suffix}`;
const imageLocs = xml => [...xml.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map(m => m[1]);
const productLocs = xml => [...xml.matchAll(/<loc>([^<]+\/p\/[^<]+)<\/loc>/g)].map(m => m[1]);

// Only the HTTP transport is replaced. The real sitemap and data helpers run.
// The last test executes actual PostgreSQL RLS; it is not a PostgREST/JWT test.
function transport(t, read) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.headers.authorization, `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`);
    assert.ok(!options.method || options.method === 'GET');
    const table = url.pathname.split('/').at(-1);
    assert.ok(['shops', 'products'].includes(table));
    if (table === 'products') {
      assert.equal(url.searchParams.get('select'), 'id,shop_id,updated_at,product_images(r2_key,r2_key_full,position)');
      assert.equal(url.searchParams.get('status'), 'eq.active');
      assert.equal(url.searchParams.has('visibility'), false, 'profile-only remains public on its shop');
    }
    requests.push(url);
    return Response.json(await read(table, url.searchParams));
  });
  return requests;
}

test('image sitemap uses real full/card images, order, canonical encoding and safe fallbacks', async t => {
  const images = [
    { r2_key: key(1, 'card.webp'), r2_key_full: key(1, 'full.webp'), position: 3 },
    { r2_key: key(1, 'کراس & "سوور".webp'), r2_key_full: null, position: 1 },
    { r2_key: key(1, 'card.webp'), r2_key_full: key(1, 'full.webp'), position: 4 },
    { r2_key: key(1, 'fallback.webp'), r2_key_full: 'products/../invalid.webp', position: 2 },
    { r2_key: 'shops/logo.webp', r2_key_full: 'https://private.test/image?token=secret', position: 5 },
    { r2_key: '', r2_key_full: null }, null,
    { r2_key_full: 'products/double//slash.webp' },
    { r2_key_full: 'products/./dot.webp' },
    { r2_key_full: 'products/control\u0000.webp' },
    { r2_key_full: 'products/back\\slash.webp' },
  ];
  transport(t, table => table === 'shops' ? [{ id: shop, slug: 'synthetic-shop', updated_at: '2026-10-01' }] : [
    { id: id(1), shop_id: shop, product_images: images },
    { id: id(2), shop_id: shop, product_images: [] },
    { id: id(3), shop_id: shop, product_images: null },
    { id: id(4), shop_id: 'not-a-public-shop', product_images: [{ r2_key: key(4) }] },
  ]);
  const xml = await (await sitemapGet(env)).text();
  assert.ok(xml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'));
  assert.deepEqual(imageLocs(xml), ['کراس & "سوور".webp', 'fallback.webp', 'full.webp'].map(suffix =>
    `${origin}/img/${key(1, suffix).split('/').map(encodeURIComponent).join('/')}`));
  assert.equal(productLocs(xml).length, 3, 'products without images keep their page URLs');
  assert.ok(!xml.includes(id(4)));
  assert.ok(!/token=|private\.test|\/shops\/|image:title|image:caption/.test(xml));
  assert.ok(xml.includes('<lastmod>2026-10-01T00:00:00.000Z</lastmod>'));
});

test('sitemap preserves product pagination without image N+1 reads or duplicate URLs', async t => {
  const products = Array.from({ length: 1001 }, (_, n) => ({ id: id(n), shop_id: shop,
    product_images: [{ r2_key: key(n), position: 1 }] }));
  const requests = transport(t, (table, params) => table === 'shops' ? [{ id: shop, slug: 'synthetic-shop' }]
    : products.slice(Number(params.get('offset')), Number(params.get('offset')) + Number(params.get('limit'))));
  const xml = await (await sitemapGet(env)).text();
  assert.equal(productLocs(xml).length, 1001);
  assert.equal(new Set(productLocs(xml)).size, 1001);
  assert.equal(imageLocs(xml).length, 1001);
  assert.deepEqual(requests.filter(u => u.pathname.endsWith('/products')).map(u => u.searchParams.get('offset')), ['0', '1000']);
  assert.equal(requests.length, 3);
  requests.length = 0;
  assert.equal((await publicProductRefs(env, 1000)).length, 1000);
  assert.equal(requests.length, 1, 'maximum is respected');
});

test('sitemap reads preserve anonymous PostgreSQL product/image eligibility through paid expiry', async t => {
  const db = await databaseFixture();
  t.after(() => db.close());
  const owner = '30000000-0000-4000-8000-000000000001';
  await db.query('insert into auth.users(id) values ($1)', [owner]);
  await db.query("insert into public.shops(id,owner_id,slug,name,whatsapp) values ($1,$2,'synthetic-shop','Synthetic','+9647000000000')", [shop, owner]);
  await db.query("update public.subscriptions set plan='months_6',status='active',paid_starts_at=now()-interval '1 day',expires_at=now()+interval '180 days' where shop_id=$1", [shop]);
  for (let n = 1; n <= 8; n++) {
    await db.query(`insert into public.products(id,shop_id,title,price,status,visibility,sort_order)
      values ($1,$2,'Synthetic',1000,$3,$4,$5)`, [id(n), shop, n === 7 ? 'hidden' : n === 8 ? 'archived' : 'active', n === 1 ? 'profile' : 'everyone', n]);
    await db.query('insert into public.product_images(product_id,shop_id,r2_key,position) values ($1,$2,$3,1)', [id(n), shop, key(n)]);
  }
  transport(t, async (table, params) => {
    await db.exec('begin; set local role anon');
    try {
      return (await db.query(table === 'shops' ? 'select id,slug,updated_at from public.shops' : `
        select p.id,p.shop_id,p.updated_at,
          (select coalesce(json_agg(json_build_object('r2_key',i.r2_key,'r2_key_full',i.r2_key_full,'position',i.position)),'[]')
            from public.product_images i where i.product_id=p.id) as product_images
        from public.products p where p.status='active' order by p.updated_at desc limit $1 offset $2`,
      table === 'shops' ? [] : [Number(params.get('limit')), Number(params.get('offset'))])).rows;
    } finally { await db.exec('rollback'); }
  });
  const assertPublic = async numbers => {
    const xml = await (await sitemapGet(env)).text();
    assert.deepEqual(productLocs(xml).sort(), numbers.map(n => `${origin}/@synthetic-shop/p/${id(n)}`).sort());
    assert.deepEqual(imageLocs(xml).sort(), numbers.map(n => `${origin}/img/${key(n)}`).sort());
  };
  await assertPublic([1, 2, 3, 4, 5, 6]);
  await db.query("update public.subscriptions set expires_at=now()-interval '1 day',grace_days=3 where shop_id=$1", [shop]);
  await assertPublic([1, 2, 3, 4, 5, 6]);
  await db.query("update public.subscriptions set expires_at=now()-interval '4 days' where shop_id=$1", [shop]);
  await assertPublic([1, 2, 3, 4, 5]);
  await db.query("update public.subscriptions set expires_at=now()+interval '180 days' where shop_id=$1", [shop]);
  await assertPublic([1, 2, 3, 4, 5, 6]);
  for (const status of ['suspended', 'banned']) {
    await db.query('update public.shops set status=$1 where id=$2', [status, shop]);
    await assertPublic([]);
  }
  assert.equal((await db.query('select count(*)::int n from public.products')).rows[0].n, 8);
  assert.equal((await db.query('select count(*)::int n from public.product_images')).rows[0].n, 8);
  assert.deepEqual((await db.query('select id,status,visibility from public.products order by sort_order')).rows.map(p => [p.status, p.visibility]),
    Array.from({ length: 8 }, (_, n) => [n === 6 ? 'hidden' : n === 7 ? 'archived' : 'active', n === 0 ? 'profile' : 'everyone']));
});
