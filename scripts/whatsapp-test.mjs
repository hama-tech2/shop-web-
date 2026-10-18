/** Synthetic public data only; real renderers/data adapters, no external requests. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { productWhatsappUrl, shopWhatsappUrl } from '../worker/render/whatsapp.js';
import { cardHtml, feedHtml } from '../worker/render/feed.js';
import { productPage } from '../worker/render/product-page.js';
import { shopHeader } from '../worker/render/shop.js';
import { getFeed, toCard } from '../worker/supabase.js';
import { searchGet } from '../worker/routes/search.js';
import { productGet, shopGet } from '../worker/routes/shop.js';
import { cardsGet } from '../worker/routes/favorites.js';

const shops = [
  { id:'shop-a', slug:'clothes', name:'جلوبەرگ', whatsapp:'٠٧٥١ ١٢٣ ٤٥٦٧', products_visible:true },
  { id:'shop-b', slug:'home', name:'ماڵ', whatsapp:'+9647509999999', products_visible:true },
];
const rows = [
  { id:'bbbbbbbb-1111-4111-8111-111111111111', title:'کراسی کوردی & ڕەنگی "سوور" + ١٠٪', price:85000, currency:'IQD', shops:shops[0] },
  { id:'bbbbbbbb-2222-4222-8222-222222222222', title:'تیشێرت', price:25, currency:'USD', shops:shops[0] },
  { id:'bbbbbbbb-3333-4333-8333-333333333333', title:'کورسی', price:45000, currency:'IQD', shops:shops[1] },
].map((row, i) => ({ ...row, shop_id:row.shops.id, description:'وەسفی ڕاستەقینە',
  product_images:[{position:0,r2_key:`products/${i}/card.webp`,r2_key_full:`products/${i}/وێنە full.webp`}] }));
const decode = value => value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const links = html => [...html.matchAll(/href="(https:\/\/wa\.me\/[^\"]+)"/g)].map(m => decode(m[1]));
const canonical = row => `https://bazarnow.xyz/@${row.shops.slug}/p/${row.id}`;
const message = href => new URL(href).searchParams.get('text');
const detail = row => ({...row, shop:row.shops, images:row.product_images.map(i=>({card:i.r2_key,full:i.r2_key_full}))});

test('card and detail have identical Sorani text, current price/currency and canonical URL', () => {
  for (const row of rows) {
    const card = toCard(row), href = productWhatsappUrl(card), url = new URL(href);
    assert.equal(href, productWhatsappUrl(detail(row)));
    assert.equal(url.origin,'https://wa.me');
    assert.equal(url.pathname, row.shops === shops[0] ? '/9647511234567' : '/9647509999999');
    assert.deepEqual([...url.searchParams.keys()],['text']);
    assert.ok(message(href).startsWith('سڵاو'));
    assert.ok(message(href).includes(row.title));
    assert.ok(message(href).includes(row.currency==='USD' ? '\u2066$25\u2069' : row.price.toLocaleString('en-US')+' د.ع'));
    assert.ok(message(href).endsWith(canonical(row)));
    assert.deepEqual(links(cardHtml(card,0)),[href]);
    assert.deepEqual(links(productPage({product:detail(row), more:[], origin:'https://host.invalid'})),[href]);
    assert.ok(!href.includes('host.invalid'));
  }
  const updated = {...toCard(rows[0]), title:'ناوی نوێ', price:120, currency:'USD', shopWhatsapp:shops[1].whatsapp};
  const href=productWhatsappUrl(updated);
  assert.equal(new URL(href).pathname,'/9647509999999');
  assert.ok(message(href).includes('$120') && message(href).includes('ناوی نوێ'));
  assert.ok(!message(href).includes(rows[0].title));
});

test('general shop greeting has its own canonical URL and no product/price', () => {
  for(const shop of shops) {
    const href=shopWhatsappUrl(shop), text=message(href);
    assert.ok(text.startsWith('سڵاو'));
    assert.ok(text.endsWith('https://bazarnow.xyz/@'+shop.slug));
    assert.ok(!text.includes('/p/') && !text.includes('نرخ:'));
    assert.deepEqual(links(shopHeader({shop,origin:'https://preview.invalid'})),[href]);
  }
});

test('missing/unsafe phone or product identity cannot produce a misleading chat', () => {
  const base=toCard(rows[0]);
  for(const phone of [null,undefined,'','not a phone','javascript:alert(1)','9647500000000?text=bad','000','1234567890123456']) {
    assert.equal(productWhatsappUrl({...base,shopWhatsapp:phone}),null);
    assert.equal(shopWhatsappUrl({...shops[0],whatsapp:phone}),null);
    assert.equal(links(cardHtml({...base,shopWhatsapp:phone},0)).length,0);
    assert.equal(links(productPage({product:{...detail(rows[0]),shop:{...shops[0],whatsapp:phone}},more:[],origin:'https://preview.invalid'})).length,0);
    assert.equal(links(shopHeader({shop:{...shops[0],whatsapp:phone},origin:'https://preview.invalid'})).length,0);
  }
  for(const patch of [{id:null},{id:''},{shopSlug:null},{shopSlug:' '},{title:null},{title:''}])
    assert.equal(productWhatsappUrl({...base,...patch}),null);
  assert.equal(productWhatsappUrl(null),null);
  assert.equal(shopWhatsappUrl(null),null);
  assert.equal(shopWhatsappUrl({...shops[0],slug:''}),null);
  for(const phone of ['+964 (751) 123-4567','009647511234567','۰۷۵۱۱۲۳۴۵۶۷'])
    assert.equal(new URL(productWhatsappUrl({...base,shopWhatsapp:phone})).pathname,'/9647511234567');
  assert.equal(new URL(shopWhatsappUrl({...shops[0],whatsapp:null,phone:'+447700900123'})).pathname,'/447700900123');
});

test('missing price stays missing; legacy currency, USD and zero are truthful', () => {
  const base=toCard(rows[0]);
  for(const price of [null,undefined,'',' ',NaN,Infinity,-1,'unknown',false])
    assert.ok(!message(productWhatsappUrl({...base,price})).includes('نرخ:'));
  assert.ok(!message(productWhatsappUrl({...base,currency:'EUR'})).includes('نرخ:'));
  assert.ok(message(productWhatsappUrl({...base,currency:undefined})).includes('85,000 د.ع'));
  assert.ok(message(productWhatsappUrl({...base,price:0})).includes('0 د.ع'));
  assert.ok(message(productWhatsappUrl({...base,price:'25',currency:'USD'})).includes('$25'));
});

test('Sorani, punctuation and URL path components survive one query decoding', () => {
  const product={...toCard(rows[0]), shopSlug:'دوکان & #?', id:'id/+?&%', customerLocation:'private', customerPhone:'private', token:'private'};
  const href=productWhatsappUrl(product), text=message(href);
  assert.ok(text.includes(rows[0].title));
  assert.ok(text.endsWith('https://bazarnow.xyz/@'+encodeURIComponent(product.shopSlug)+'/p/'+encodeURIComponent(product.id)));
  assert.ok(!text.includes('private'));
  assert.equal([...new URL(href).searchParams.keys()].length,1);
  const html=cardHtml({...toCard(rows[0]),title:'<img onerror="alert(1)">'},0);
  assert.ok(!html.includes('<img onerror'));
});

test('all real public render paths route each product to its own seller; OG uses its actual image/title', async () => {
  const original=globalThis.fetch, reads=[];
  globalThis.fetch=async (input,init) => {
    const url=new URL(input); reads.push({url,init});
    assert.equal(url.origin,'https://synthetic.invalid');
    assert.equal(init.headers.authorization,'Bearer synthetic-public');
    assert.ok(!init.method || init.method==='GET');
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/shop_public_profile') return Response.json(shops.filter(s=>s.slug===url.searchParams.get('p_slug')));
    if(path==='rpc/search_shops' || path==='platform_categories' || path==='categories') return Response.json([]);
    let selected=rows;
    const id=url.searchParams.get('id'), shop=url.searchParams.get('shop_id');
    if(id?.startsWith('eq.')) selected=selected.filter(r=>r.id===id.slice(3));
    if(id?.startsWith('neq.')) selected=selected.filter(r=>r.id!==id.slice(4));
    if(shop?.startsWith('eq.')) selected=selected.filter(r=>r.shop_id===shop.slice(3));
    return Response.json(selected);
  };
  const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-public'};
  try {
    const cards=(await getFeed(env,{limit:20,offset:0})).products;
    const surfaces=[
      ['For You',feedHtml({products:cards,hasMore:false,offset:0,pageSize:20})],
      ['Search',await (await searchGet(env,new URL('https://preview.invalid/search?q=test'))).text()],
      ['Favorites cards',await (await cardsGet(env,new URL('https://preview.invalid/api/favorites/cards?ids='+rows.map(r=>r.id).join(',')))).text()],
    ];
    for(const [name,html] of surfaces) assert.deepEqual(links(html),cards.map(productWhatsappUrl),name);
    for(const row of rows) {
      const path=`/@${row.shops.slug}/p/${row.id}`, url=new URL('https://preview.invalid'+path);
      const response=await productGet(new Request(url),env,url,row.shops.slug,row.id);
      assert.equal(response.status,200);
      const html=await response.text(), href=productWhatsappUrl(detail(row));
      assert.equal(links(html)[0],href);
      const related=rows.filter(r=>r.shop_id===row.shop_id && r.id!==row.id);
      assert.deepEqual(links(html).slice(1),related.map(r=>productWhatsappUrl(toCard(r))));
      const meta=key=>decode(html.match(new RegExp(`<meta property="${key}" content="([^"]*)"`))?.[1] || '');
      assert.ok(meta('og:title').includes(row.title));
      assert.equal(meta('og:url'),canonical(row));
      const version=createHash('sha256').update('1\n'+row.product_images[0].r2_key_full).digest('hex').slice(0,32);
      const actualImage=`https://bazarnow.xyz/preview/products/${row.id}/${version}.jpg`;
      assert.equal(meta('og:image'),actualImage);
      assert.equal(meta('og:image:secure_url'),actualImage);
      assert.equal(meta('og:image:type'),'image/jpeg');
      assert.equal(meta('og:image:width'),'600');
      assert.equal(meta('og:image:height'),'600');
      const shopUrl=new URL('https://preview.invalid/@'+row.shops.slug);
      const shopHtml=await (await shopGet(new Request(shopUrl),env,shopUrl,row.shops.slug)).text();
      assert.equal(links(shopHtml)[0],shopWhatsappUrl(row.shops));
      assert.deepEqual(links(shopHtml).slice(1),rows.filter(r=>r.shop_id===row.shop_id).map(r=>productWhatsappUrl(toCard(r))));
    }
    assert.ok(reads.length>10);
  } finally {globalThis.fetch=original;}
});

test('client contact remains normal navigation without automatic sending or personal-data collection', async () => {
  const source=await readFile(new URL('../worker/render/whatsapp.js',import.meta.url),'utf8');
  assert.ok(!/fetch\(|geolocation|sendMessage|access_token|customerPhone/.test(source));
  const html=cardHtml(toCard(rows[0]),0);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
});
