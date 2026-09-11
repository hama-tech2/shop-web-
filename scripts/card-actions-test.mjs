/** Local-only shared-card data, interaction and mobile regressions. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { cardHtml } from '../worker/render/feed.js';
import { layout } from '../worker/render/layout.js';
import { getFeed, getShopProducts, searchProducts, getProductsByIds, getMoreFromShop } from '../worker/supabase.js';

let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; };
const id = 'bbbbbbbb-1111-4111-8111-111111111111';
const profile = { name:'دوکانی تاقیکردنەوە', slug:'fixture-shop', logo_key:'fixture-logo', whatsapp:'٠٧٥١ ١٢٣ ٤٥٦٧', phone:null, maps_url:'https://maps.app.goo.gl/fixture' };
const row = { id, title:'بەرهەمێک بە ناوێکی درێژ بۆ تاقیکردنەوەی ڕیزبەندی', price:75000, shops:profile, product_images:[{r2_key:'fixture-image',position:0}] };
const env = {SUPABASE_URL:'https://stub.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture-public'};
const realFetch = globalThis.fetch;
const reads = [];
globalThis.fetch = async (url, init) => {
  reads.push({url:new URL(url),init});
  return Response.json([row]);
};
let product;
try {
  product = (await getFeed(env,{limit:10,offset:0})).products[0];
  const cards = [product, ...(await getShopProducts(env,'shop')), ...(await searchProducts(env,{query:'x',limit:10})).products,
    ...(await getProductsByIds(env,[id])), ...(await getMoreFromShop(env,'shop','another'))];
  check('all card sources read shop contact fields', cards.every(p=>p.shopWhatsapp===profile.whatsapp && p.shopMapsUrl===profile.maps_url));
  check('no extra per-card request or privileged key', reads.length===5 && reads.every(r=>r.url.searchParams.get('select').includes('shops!inner(name,slug,logo_key,whatsapp,phone,maps_url)') && r.init.headers.authorization==='Bearer fixture-public' && !r.init.method));
  profile.whatsapp='+9647509999999'; profile.maps_url='https://maps.app.goo.gl/updated';
  const updated=(await getFeed(env,{limit:10,offset:0})).products[0];
  check('shop edits flow into newly rendered cards', cardHtml(updated,0).includes('https://wa.me/9647509999999') && cardHtml(updated,0).includes('/updated'));
  profile.whatsapp=null; profile.phone='+9647508888888';
  check('profile phone fallback is supported', (await getFeed(env,{limit:10,offset:0})).products[0].shopWhatsapp===profile.phone);
} finally { globalThis.fetch=realFetch; }
check('unsafe location and invalid phone are omitted', !cardHtml({...product,shopWhatsapp:'not a phone',shopMapsUrl:'javascript:alert(1)'},0).includes('card__action--location') && !cardHtml({...product,shopWhatsapp:null,shopMapsUrl:null},0).includes('card__action--whatsapp'));
const cards = [product, {...product,id:'second',price:999999999}, {...product,id:'third',shopWhatsapp:null,shopMapsUrl:null}, {...product,id:'fourth',shopMapsUrl:null}];
const body = `<main class="page"><div class="grid">${cards.map((p,i)=>cardHtml(p,i)).join('')}</div></main>`;
const html = layout({title:'Card fixture',body,scripts:['/js/favorites.js']});
const root=resolve('public');
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if (path==='/cards') {res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}
  if (path==='/api/favorites') {res.setHeader('content-type','application/json');return res.end(JSON.stringify({signedIn:false,ids:[]}));}
  if (path.startsWith('/img/')) {res.setHeader('content-type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#EFEBE3"/><path d="M200 400h400v400H200zM300 400V250h200v150" fill="none" stroke="#14563D" stroke-width="20"/></svg>');}
  if (path.startsWith('/@')) return res.end('Product detail destination');
  const file=resolve(root,'.'+path);
  if (!file.startsWith(root+sep)) {res.statusCode=404;return res.end();}
  try {res.setHeader('content-type',{'.css':'text/css','.js':'text/javascript'}[extname(file)]||'application/octet-stream');res.end(await readFile(file));}
  catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const out=join(tmpdir(),'bazaro-card-actions'); await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    window.shared=[];window.copied=[];window.shareMode='success';window.copyMode='success';
    Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{window.shared.push(data);if(window.shareMode==='cancel')throw new DOMException('Cancelled','AbortError');if(window.shareMode==='fail')throw new Error('Unavailable');}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{if(window.copyMode==='fail')throw new Error('Denied');window.copied.push(text);}}});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const destination=origin+'/@fixture-shop/p/'+id;
  for (const width of [320,360,390,430]) {
    await page.setViewportSize({width,height:844});await page.goto(origin+'/cards');await page.evaluate(()=>document.fonts.ready);
    const metrics=await page.locator('.card').evaluateAll(els=>els.map(el=>{
      const rect=el.getBoundingClientRect(), img=el.querySelector('.card__media').getBoundingClientRect();
      const price=el.querySelector('.card__price').getBoundingClientRect();
      const actions=[...el.querySelectorAll('.card__action')].map(a=>a.getBoundingClientRect());
      return {width:rect.width,ratio:img.width/img.height,overflow:el.scrollWidth>el.clientWidth,
        priceInside:price.left>=rect.left&&price.right<=rect.right,
        targets:actions.every(a=>a.width>=44&&a.height>=44&&a.left>=rect.left&&a.right<=rect.right),
        separated:actions.every((a,i)=>!i||a.left>=actions[i-1].right),
        noPriceOverlap:actions.every(a=>a.top>=price.bottom||a.left>=price.right||a.right<=price.left)};
    }));
    check('two original-width columns '+width,metrics.every(m=>Math.abs(m.width-(width-44)/2)<1));
    check('unchanged 4:5 cover '+width,metrics.every(m=>Math.abs(m.ratio-.8)<.01));
    check('price and actions stay inside card '+width,metrics.every(m=>!m.overflow&&m.priceInside&&m.targets));
    check('independent, non-overlapping action targets '+width,metrics.every(m=>m.separated&&m.noPriceOverlap));
    check('RTL no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.dir==='rtl'&&document.documentElement.scrollWidth<=innerWidth));
    check('price directly below and aligned with right of title '+width,await page.locator('.card').evaluateAll(els=>els.every(el=>{
      const title=el.querySelector('.card__title').getBoundingClientRect(), price=el.querySelector('.card__price').getBoundingClientRect();
      return price.top>=title.bottom && Math.abs(price.right-title.right)<1;
    })));
    check('entire normal price remains readable '+width,await page.locator('.card__amount').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth)));
    check('heart subtle visual, full tap target '+width,await page.locator('.card__heart').first().evaluate(el=>el.offsetWidth>=44&&el.offsetHeight>=44&&getComputedStyle(el,'::before').width==='28px'));
    check('missing contacts have no empty controls '+width,await page.locator('.card').nth(2).locator('.card__action').count()===1);
    check('valid semantic controls '+width,await page.locator('a button, button a, a a').count()===0);
    await page.screenshot({path:join(out,`cards-${width}.png`),fullPage:true});
    // A wider fallback font/enlarged text must not defeat the price constraint.
    const widerPrice = await page.addStyleTag({content:'.card__amount { font-family: Arial, sans-serif !important; font-size: 24px !important; }'});
    check('long price stays constrained with enlarged fallback text '+width,await page.locator('.card').nth(1).evaluate(el=>{
      const price=el.querySelector('.card__price'), amount=el.querySelector('.card__amount'), currency=el.querySelector('.card__currency');
      const cardRect=el.getBoundingClientRect(), p=price.getBoundingClientRect(), a=amount.getBoundingClientRect(), c=currency.getBoundingClientRect();
      return el.scrollWidth<=el.clientWidth && p.left>=cardRect.left && p.right<=cardRect.right &&
        (a.right<=c.left || c.top>=a.bottom) && c.right<=p.right && currency.scrollWidth<=currency.clientWidth &&
        amount.textContent==='999,999,999' && (amount.scrollWidth<=amount.clientWidth ||
          (getComputedStyle(amount).overflowX==='hidden' && getComputedStyle(amount).textOverflow==='ellipsis'));
    }));
    await widerPrice.evaluate(el=>el.remove());
  }
  const first=page.locator('.card').first();
  await first.locator('[data-card-share]').click();
  check('native share is exact canonical product URL',await page.evaluate(url=>shared.length===1&&shared[0].url===url&&copied.length===0,destination));
  check('share does not open detail',new URL(page.url()).pathname==='/cards');
  await page.evaluate(()=>{window.shareMode='cancel';});await first.locator('[data-card-share]').click();
  check('native cancellation does not copy',await page.evaluate(()=>copied.length===0));
  await page.evaluate(()=>{window.shareMode='fail';});await first.locator('[data-card-share]').click();
  await page.waitForFunction(()=>copied.length===1);
  check('native-share failure falls back to copy',await page.evaluate(url=>copied[0]===url,destination));
  await page.evaluate(()=>{window.copied=[];});
  await page.evaluate(()=>{Object.defineProperty(navigator,'share',{value:undefined});});await first.locator('[data-card-share]').click();
  await page.waitForFunction(()=>copied.length===1);
  check('clipboard fallback confirms without navigation',await page.evaluate(url=>copied[0]===url,destination)&&await page.locator('.card-share-status').isVisible()&&new URL(page.url()).pathname==='/cards');
  await page.evaluate(()=>{window.copyMode='fail';document.execCommand=(name)=>{window.legacyCopied=document.querySelector('textarea').value;return name==='copy';};});
  await first.locator('[data-card-share]').click();await page.waitForFunction(()=>window.legacyCopied);
  check('legacy clipboard fallback cleans up',await page.evaluate(url=>legacyCopied===url&&document.querySelectorAll('textarea').length===0,destination));
  await page.evaluate(()=>{document.execCommand=()=>false;});await first.locator('[data-card-share]').click();
  check('copy failure has honest feedback', (await page.locator('.card-share-status').innerText()).includes('سەرکەوتوو نەبوو'));
  await page.evaluate(()=>{document.execCommand=()=>{window.legacyCopied=document.querySelector('textarea').value;return true;};});
  await first.locator('[data-fav]').click();check('favorite saves without navigation',await first.locator('[data-fav]').getAttribute('aria-pressed')==='true'&&new URL(page.url()).pathname==='/cards');
  await first.locator('[data-fav]').click();check('favorite unsaves',await first.locator('[data-fav]').getAttribute('aria-pressed')==='false');
  check('WhatsApp normalized, no message',await first.locator('.card__action--whatsapp').getAttribute('href')==='https://wa.me/9647511234567');
  for (const cls of ['whatsapp','location']) {
    const link=first.locator('.card__action--'+cls), href=await link.getAttribute('href');
    // Verify the navigation request, not the third-party site's page lifecycle.
    // Abort it so tests never depend on WhatsApp/app redirects or a map service.
    await context.route(href,route=>route.abort());
    const [request,popup]=await Promise.all([context.waitForEvent('request',r=>r.url()===href),context.waitForEvent('page'),link.click()]);
    const rel=(await link.getAttribute('rel')).split(' ');
    check(cls+' only opens its safe external destination',request.url()===href&&new URL(page.url()).pathname==='/cards'&&rel.includes('noopener')&&rel.includes('noreferrer'));
    await popup.close();
  }
  await first.locator('[data-fav]').focus(); await page.keyboard.press('Tab');
  check('keyboard focus visible',await first.locator('[data-card-share]').evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle==='solid'));
  await page.evaluate(markup=>document.querySelector('.grid').insertAdjacentHTML('beforeend',markup),cardHtml({...product,id:'appended'},5));
  await page.locator('.card').last().locator('[data-card-share]').click();await page.waitForFunction(()=>window.legacyCopied.endsWith('/appended'));
  check('appended cards share through same handler',await page.evaluate(()=>legacyCopied.endsWith('/appended')));
  await first.locator('.card__title').scrollIntoViewIfNeeded();
  const title=await first.locator('.card__title').boundingBox();
  await Promise.all([page.waitForURL(destination),page.mouse.click(title.x+title.width/2,title.y+title.height/2)]);
  check('normal card still opens detail',page.url()===destination);
  check('no browser script errors',errors.length===0);
  await context.close();
} finally {await browser.close();await new Promise(r=>server.close(r));}
console.log(`All ${checks} card action checks passed. Screenshots: ${out}`);
