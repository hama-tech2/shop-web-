import test from 'node:test';
import assert from 'node:assert/strict';
const APP=process.argv.find(a=>a.startsWith('http')) || 'http://127.0.0.1:8810';
const STUB='http://127.0.0.1:8899',shop='aaaaaaaa-1111-4111-8111-111111111111',id='bbbbbbbb-1111-4111-8111-111111111111';
const cookie='sb-access=TEST';
const set=path=>fetch(STUB+path).then(r=>r.json());
const get=path=>fetch(APP+path,{headers:{cookie}});
const post=(path,body)=>fetch(APP+path,{method:'POST',redirect:'manual',headers:{cookie,origin:APP},body:new URLSearchParams(body)});
const images=n=>JSON.stringify(Array.from({length:n},(_,i)=>({card:`products/${shop}/${id}/${i}-card.webp`,full:`products/${shop}/${id}/${i}-full.webp`})));
const fields={draft_id:id,title:'Draft survives',price:'1000',currency:'IQD',visibility:'profile',description:'Unfinished text',images:images(5)};
test('Worker permanent Free and customer regression using localhost stubs',async t=>{
  await set('/__mode/shop');await set('/__rows/1');await set('/__plan/free');await set('/__trial/-100');await set('/__products/4');await set('/__suspended/0');
  await t.test('fifth can choose Free without payment and submit atomically',async()=>{
    assert.match(await (await get('/app/new')).text(),/value="free" checked/);
    assert.equal((await post('/app/subscription/free',{})).headers.get('location'),'/app/new?plan=free');
    const form=await (await get('/app/new?plan=free')).text();
    assert.match(form,/data-max="5"/);assert.match(form,/data-owner="aaaaaaaa/);
    await set('/__calls/reset');
    const published=await post('/app/new',fields);
    assert.equal(published.status,303);assert.equal(published.headers.get('location'),'/app?published='+id);
    const writes=await set('/__writes');
    assert.ok(writes.some(w=>w.table==='rpc/publish_product'));
    assert.ok(!writes.some(w=>w.table==='products' && w.method==='POST'));
  });
  await t.test('sixth blocked with complete draft and upgrade link preserved',async()=>{
    await set('/__products/5');
    const response=await post('/app/new',fields);const html=await response.text();
    assert.equal(response.status,200);assert.match(html,/Draft survives/);assert.match(html,/Unfinished text/);
    assert.match(html,new RegExp(id));assert.match(html,/data-draft-upgrade/);
    assert.match(html,/4-card.webp/);
    assert.match(await (await get('/app/new?plan=free&draft='+id)).text(),/id="product-form"/);
    assert.match(await (await get('/app/new')).text(),/value="free" disabled/);
  });
  await t.test('sixth image refused with filled fields',async()=>{
    await set('/__products/4');
    const html=await (await post('/app/new',{...fields,images:images(6)})).text();
    assert.match(html,/Draft survives/);assert.match(html,/5 وێنە/);
  });
  await t.test('pricing and Settings show no trial clock and navigation is retained',async()=>{
    const html=await (await get('/app/subscription')).text();
    assert.match(html,/data-plan-state="free"/);assert.match(html,/5,000/);assert.match(html,/9,000/);
    assert.doesNotMatch(html,/60 ڕۆژ|60 ڕۆژی|مانگی بەخۆڕایی|value="month_1"/);
    const account=await (await get('/app')).text();
    for(const target of ['/app/profile','/@nafin-boutique','/logout','id="account-settings"','data-shop-url="/app/owner-products"']) assert.ok(account.includes(target),target);
    assert.match(account,/بەخۆڕایی بێ کۆتایی/);
  });
  await t.test('owner grid has retained products while customer pages keep contacts and avoid stale cache',async()=>{
    await set('/__mixed/1');
    assert.match(await (await get('/app/owner-products')).text(),/data-retained=/);
    await set('/__mixed/0');
    for(const path of ['/', '/search?q=test', '/@nafin-boutique', '/@nafin-boutique/p/'+id, '/sitemap.xml']) {
      const response=await get(path);assert.equal(response.status,200,path);
      assert.equal(response.headers.get('cache-control'),'no-store',path);
    }
    const publicShop=await (await get('/@nafin-boutique')).text();
    assert.match(publicShop,/https:\/\/wa.me\/9647510000002/);
    assert.doesNotMatch(publicShop,/owner-product-menu|data-retained/);
  });
  await t.test('paid/scheduled/grace presentation respects authoritative state',async()=>{
    await set('/__plan/months_6');await set('/__trial/-1');await set('/__sub/150');
    assert.match(await (await get('/app/subscription')).text(),/data-plan-state="active"/);
    await set('/__sub/-1');
    assert.match(await (await get('/app/subscription')).text(),/data-plan-state="grace"/);
    await set('/__sub/-4');
    assert.match(await (await get('/app/subscription')).text(),/data-plan-state="free"/);
    await set('/__sub/180');await set('/__trial/20');
    assert.match(await (await get('/app/subscription')).text(),/data-plan-state="scheduled"/);
  });
});
