import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { chromium } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';
const APP='http://127.0.0.1:8810',STUB='http://127.0.0.1:8899';
const owner='aaaaaaaa-1111-4111-8111-111111111111';
const control=path=>fetch(STUB+path).then(r=>r.json());
for(const path of ['/__mode/shop','/__plan/free','/__trial/-100','/__products/29','/__rows/1','/__mixed/0','/__suspended/0']) await control(path);
const browser=await chromium.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--disable-component-update']});
const context=await browser.newContext({viewport:{width:390,height:844}});
await context.addCookies([{name:'sb-access',value:'TEST',url:APP}]);
await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
const page=await context.newPage(),errors=[];
const posts=[];
page.on('response',response=>{
  if(response.request().method()==='POST' && new URL(response.url()).hostname==='127.0.0.1')
    posts.push({path:new URL(response.url()).pathname,status:response.status()});
});
page.on('pageerror',e=>errors.push(e.message));
let checks=0;
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS '+name);};
const waitDraft = async predicate => {
  for(let n=0;n<100;n++) {
    const draft=await page.evaluate(async owner=>await ProductDrafts.get(owner),owner);
    if(predicate(draft)) return;
    await delay(100);
  }
  throw new Error('Draft persistence condition timed out');
};
try {
  await page.goto(APP+'/app');
  await page.locator('.owner-control--primary').click();
  await page.waitForURL(APP+'/app/new');
  await page.waitForFunction(()=>document.querySelector('#product-form')?.dataset.ready==='true');
  check('Add Product opens the thirtieth product form directly',await page.locator('#product-form').isVisible());
  check('no subscription choice or checkout script before the thirtieth product',await page.locator('.billing--gate, #start-trial, script[src="/js/checkout.js"]').count()===0);
  await page.locator('#f-title').fill('Draft browser fixture');
  await page.locator('#f-price').fill('12500');
  await page.locator('#f-description').fill('Keep unfinished text');
  const png=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
    canvas.getContext('2d').fillRect(0,0,16,16);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#photo-input').setInputFiles(Array.from({length:5},(_,i)=>({name:'synthetic-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})));
  await page.waitForFunction(()=>document.querySelectorAll('.publish-photo').length===5 && !document.querySelector('#save-btn').disabled);
  await waitDraft(draft=>draft?.items?.length===5);
  const draft=await page.locator('#product-form').getAttribute('data-draft');
  check('five local image Blobs persisted',await page.evaluate(async owner=>(await ProductDrafts.get(owner)).items.every(i=>i.cardBlob instanceof Blob && i.fullBlob instanceof Blob),owner));
  await page.goto(APP+'/app/subscription');
  await page.waitForSelector('[data-resume-draft]');
  check('Free has no expiry countdown',await page.locator('.billing-state').getAttribute('data-plan-state')==='free');
  await page.locator('[data-resume-draft]').click();
  await page.waitForFunction(()=>document.querySelector('#product-form')?.dataset.ready==='true');
  check('draft ID survives upgrade navigation',await page.locator('#product-form').getAttribute('data-draft')===draft);
  check('title survives upgrade navigation',await page.locator('#f-title').inputValue()==='Draft browser fixture');
  check('description survives upgrade navigation',await page.locator('#f-description').inputValue()==='Keep unfinished text');
  check('all five image previews recovered',await page.locator('.publish-photo').count()===5);
  await control('/__products/30');
  await page.locator('#save-btn').click();
  await page.waitForSelector('[data-draft-upgrade]');
  await page.waitForFunction(()=>document.querySelector('#product-form')?.dataset.ready==='true');
  check('racing quota refusal keeps fields and images',await page.locator('#f-title').inputValue()==='Draft browser fixture' && await page.locator('.publish-photo').count()===5);
  await page.locator('[data-draft-upgrade]').click();
  await page.waitForSelector('[data-resume-draft]');
  await page.locator('[data-resume-draft]').click();
  await page.waitForFunction(()=>document.querySelector('#product-form')?.dataset.ready==='true');
  await control('/__products/29');
  await context.route(APP+'/app?published=*',async route=>{
    await control('/__products/30'); await route.continue();
  },{times:1});
  await page.locator('#save-btn').click();
  await page.waitForURL('**/app?published=*');
  await waitDraft(draft=>!draft);
  check('publishing the thirtieth returns home without an automatic upgrade',new URL(page.url()).pathname==='/app' && await page.locator('.billing--gate').count()===0);
  check('successful publish clears only the saved owner draft',await page.locator('[data-resume-draft]').count()===0);
  await page.goBack();
  // With no-store, Chrome may reload the existing plan-choice gate instead
  // of restoring the form from BFCache. Both paths must keep committed work
  // cleared; require a disabled Save only when that old form was restored.
  await page.waitForFunction(()=>document.querySelector('.billing--gate') ||
    (document.querySelector('#product-form')?.dataset.ready==='true' && document.querySelector('#save-btn')?.disabled));
  await waitDraft(draft=>!draft);
  check('browser Back does not recreate a committed draft',
    await page.locator('.billing--gate').count()===1 || await page.locator('#save-btn').isDisabled());
  await page.goto(APP+'/app');
  await control('/__products/30');
  await page.locator('.owner-control--primary').click();
  await page.waitForSelector('.billing--gate');
  check('Add Product for the thirty-first shows the existing upgrade page',await page.locator('#product-form, #start-trial').count()===0 && await page.locator('form[action="/app/subscription/checkout"]').count()>0);
  await control('/__products/29');
  await page.goto(APP+'/app');
  await page.locator('#owner-management-toggle').click();
  await page.locator('#settings-open').click();
  await page.waitForFunction(()=>location.hash==='#account-settings');
  check('existing Settings identity/card/navigation retained without a Free upsell',await page.locator('.settings-identity').isVisible() && await page.locator('.settings-plan').isVisible() && await page.locator('#settings-subscription').count()===0);
  await page.locator('#settings-back').click();
  check('Settings Back returns to existing owner screen',await page.locator('.owner-controls').isVisible());
  for(const width of [360,390,430]) {
    await page.setViewportSize({width,height:844});await page.goto(APP+'/app/subscription/start');
    check(width+' RTL choices fit viewport',await page.evaluate(()=>document.documentElement.dir==='rtl' && document.documentElement.scrollWidth<=innerWidth));
    check(width+' Free and paid options remain tap targets',await page.locator('.billing-choice__surface').evaluateAll(els=>els.length===3 && els.every(el=>el.getBoundingClientRect().height>=44)));
  }
  check('no browser JavaScript errors',errors.length===0);
  await page.goto(APP+'/app');
  const recoveredId=randomUUID();
  await page.evaluate(async ({owner,png,id})=>{
    const blob=new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'});
    await ProductDrafts.put(owner,{id,fields:{title:'Missing upload recovery',price:'12500',currency:'IQD',status:'active',visibility:'everyone',description:''},
      items:Array.from({length:5},(_,i)=>({card:'products/'+owner+'/'+id+'/'+i+'-card.webp',full:'products/'+owner+'/'+id+'/'+i+'-full.webp',backupCard:blob,backupFull:blob}))});
  },{owner,png,id:recoveredId});
  await page.goto(APP+'/app/new?plan=free&draft='+recoveredId);
  await page.waitForFunction(()=>document.querySelector('#product-form')?.dataset.ready==='true');
  check('missing draft R2 uploads recover all five local images',await page.locator('.publish-photo').count()===5 && await page.locator('#images-field').inputValue()==='[]');
  await page.locator('#save-btn').click();
  await page.waitForURL('**/app?published='+recoveredId);
  await waitDraft(draft=>!draft);
  check('recovered images can be uploaded and published again',true);
  await page.goto(APP+'/app/new?plan=free');
  await page.waitForFunction(()=>document.querySelector('#product-form')?.dataset.ready==='true');
  await page.locator('#f-title').fill('Logout draft fixture');
  const unfinished=await page.locator('#product-form').getAttribute('data-draft');
  await page.locator('.publish-head a').click();
  await page.waitForURL(APP+'/app');
  await page.waitForSelector('[data-resume-draft]');
  check('Back saves the last edit before navigating',await page.evaluate(async owner=>(await ProductDrafts.get(owner)).fields.title==='Logout draft fixture',owner));
  check('draft is scoped to its owner shop',!(await page.evaluate(async()=>await ProductDrafts.get('stranger-shop'))));
  await page.goto(APP+'/app?published='+unfinished);
  await page.waitForSelector('[data-resume-draft]');
  check('an unverified published URL cannot erase unfinished work',true);
  await page.locator('#owner-management-toggle').click();
  await page.locator('#settings-open').click();
  await page.locator('.settings-logout button').click();
  await page.waitForURL(APP+'/');
  await page.addScriptTag({url:APP+'/js/draft-store.js'});
  check('Logout clears owner drafts and completed markers',await page.evaluate(async({owner,id})=>!(await ProductDrafts.get(owner)) && !(await ProductDrafts.completed(owner,id)),{owner,id:recoveredId}));
  check('no JavaScript errors during recovery or logout',errors.length===0);
  console.log(checks+'/'+checks+' browser checks passed');
} catch(error) {
  console.error('Local browser failure evidence', JSON.stringify({
    path:new URL(page.url()).pathname,
    message:await page.locator('#product-message').textContent().catch(()=>null),
    ready:await page.locator('#product-form').getAttribute('data-ready').catch(()=>null),
    posts
  }));
  throw error;
} finally {await browser.close();}
