/** Isolated renderer fixtures; no production fixture routes or writes. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layout } from '../worker/render/layout.js';
import { productPage } from '../worker/render/product-page.js';
import { productForm } from '../worker/render/product-form.js';
import { getProduct } from '../worker/supabase.js';

const APP=process.argv[2] || 'http://127.0.0.1:8810';
const out=join(tmpdir(),'bazaro-final-ui'); await mkdir(out,{recursive:true});
let checks=0;
const check=(name,ok)=>{assert.ok(ok,name);checks++;};
const id='bbbbbbbb-1111-4111-8111-111111111111';
const shop={id:'aaaaaaaa-1111-4111-8111-111111111111',name:'دوکانی تاقیکردنەوە بە ناوێکی درێژ',slug:'fixture-shop',whatsapp:'07510000002',maps_url:'https://maps.app.goo.gl/fixture',city:'erbil'};
const title='بەرهەمێکی جوان بە ناوێکی درێژ بۆ تاقیکردنەوەی ڕیزبەندی';
const images=[{card:'fixture',full:'fixture'}];
const product={id,title,price:999999999,description:'وردەکارییەکانی بەرهەم',shop,images};
const more=[{id:'related',title,price:72000,shopName:shop.name,shopSlug:shop.slug,shopWhatsapp:shop.whatsapp,shopMapsUrl:shop.maps_url,images:['fixture']}];
const realFetch=globalThis.fetch;let selected='';
try {
  globalThis.fetch=async(url)=>{selected=new URL(url).searchParams.get('select');return Response.json([{...product,shops:shop,product_images:[]}]);};
  const detail=await getProduct({SUPABASE_URL:'https://stub.invalid',SUPABASE_PUBLISHABLE_KEY:'stub'},id);
  check('PDP selects current shop maps URL',selected.includes('city,maps_url)')&&detail.shop.maps_url===shop.maps_url);
} finally {globalThis.fetch=realFetch;}
const browser=await chromium.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const ctx=await browser.newContext();
  await ctx.addInitScript(()=>{
    window.copied=[];window.shared=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>{window.copied.push(url);}}});
    Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.shared.push(data);}});
  });
  const page=await ctx.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await ctx.route('**/img/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#EFEBE3"/></svg>'}));
  await ctx.route('**/api/favorites',route=>route.fulfill({json:{signedIn:false,ids:[]}}));
  await ctx.route(APP+'/_fixture/**',route=>{
    const url=new URL(route.request().url());
    const screen=url.pathname.split('/').pop(), state=url.searchParams.get('state');
    const body=screen==='product' ? productPage({product:{...product,shop:{...shop,maps_url:state==='missing'?null:state==='unsafe'?'javascript:alert(1)':shop.maps_url}},more,origin:APP})
      : productForm({mode:'edit',draftId:id,categories:[],imageLimit:1,values:{title,price:999999999,status:state || 'hidden',images:state==='kept'?[...images,{card:'old-2',full:'old-2'},{card:'old-3',full:'old-3'}]:images},error:state==='error'?'هەڵەی پاشەکەوتکردن':null});
    return route.fulfill({contentType:'text/html',body:layout({title:'UI fixture',body,scripts:screen==='product'?['/js/shop.js','/js/favorites.js']:['/js/product.js']})});
  });
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  for(const width of [320,360,390,430]) {
    await page.setViewportSize({width,height:844});
    for(const state of ['hidden','active','error','kept']) {
      await page.goto(APP+'/_fixture/edit?state='+state);
      check('restricted edit keeps title and category '+width+state,await page.locator('#f-title').inputValue()===title&&await page.locator('#category-field').count()===1);
      check('restricted edit omits protected fields '+width+state,await page.locator('#product-form').locator('[name="price"],[name="currency"],[name="status"],[name="description"],[name="own_category"]').count()===0);
      check('price remains visible but locked '+width+state,await page.locator('.edit-price__value').isVisible());
      check('edit posts to the existing owned URL '+width+state,await page.locator('#product-form').getAttribute('action')==='/app/products/'+id);
      check('edit no overflow '+width+state,!await overflow());
      check('cover-only edit offers replacement without gallery mutation controls '+width+state,await page.locator('#product-form').getAttribute('data-cover-only')==='true'&&await page.locator('#add-photo').isVisible()&&await page.locator('#add-photo').getAttribute('aria-label')==='گۆڕینی کاڤەر'&&await page.locator('.thumb__x,.photo-order').count()===0);
    }
    for(const state of ['present','missing','unsafe']) {
      await page.goto(APP+'/_fixture/product?state='+state);await page.evaluate(()=>document.fonts.ready);
      check('PDP no overflow '+width+state,!await overflow());
      check('PDP shop maps only when safe '+width+state,await page.locator('.pdp-secondary a').count()===(state==='present'?1:0));
      check('one primary WhatsApp preserved '+width+state,await page.locator('.pdp-order .btn--whatsapp').count()===1);
      check('PDP secondary touch targets '+width+state,await page.locator('.pdp-secondary .card__action').evaluateAll(as=>as.every(a=>a.offsetWidth>=44&&a.offsetHeight>=44)));
      check('PDP only one share control outside related cards '+width+state,await page.locator('.pdp-body [data-card-share]').count()===1&&await page.locator('.pdp-toolbar [data-card-share],#share-btn').count()===0);
      if(state==='present') await page.screenshot({path:join(out,'product-'+width+'.png'),fullPage:true});
    }
  }
  await page.goto(APP+'/_fixture/product?state=present');
  const share=page.locator('.pdp-secondary [data-card-share]'),canonical=APP+'/@fixture-shop/p/'+id;
  await share.click();check('PDP shares exact product',await page.evaluate(url=>shared[0].url===url,canonical));
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:undefined}));await share.click();
  await page.waitForFunction(()=>copied.length===1);
  check('PDP copy confirms without navigation',await page.evaluate(url=>copied[0]===url,canonical)&&await page.locator('.card-share-status').isVisible()&&new URL(page.url()).pathname==='/_fixture/product');
  check('PDP location opens safely',await page.locator('.pdp-secondary a').getAttribute('href')===shop.maps_url&&await page.locator('.pdp-secondary a').getAttribute('rel')==='noopener noreferrer');
  // Owner Edit/Delete now live only in the card menu. The focused owner
  // suite drives that menu and its confirmation; the edit screen must
  // not expose another delete action.
  await page.goto(APP+'/_fixture/edit?state=hidden');
  check('edit form has no direct delete action',await page.locator('form[action$="/delete"]').count()===0);
  await page.goto(APP+'/_fixture/edit?state=kept');
  let editFields;
  await page.route(APP+'/app/products/'+id,route=>{editFields=new URLSearchParams(route.request().postData());return route.fulfill({status:204});});
  await Promise.all([page.waitForRequest(r=>r.method()==='POST'&&r.url()===APP+'/app/products/'+id),page.locator('#save-btn').click()]);
  check('cover edit keeps every retained image',JSON.parse(editFields.get('images')).length===3);
  check('edit submits no protected product fields',['price','currency','status','description','own_category'].every(name=>editFields.get(name)===null));
  check('no browser errors',errors.length===0);
  await ctx.close();
} finally {await browser.close();}
console.log(`All ${checks} final UI checks passed. Screenshots: ${out}`);
