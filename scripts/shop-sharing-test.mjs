/** Local Worker + synthetic auth/data only. QR images are independently decoded. */
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import jsQR from 'jsqr';
import {publicShopUrl} from '../worker/render/shop-sharing.js';
import {shopQrPage} from '../worker/render/shop-qr.js';
import {layout} from '../worker/render/layout.js';

const APP=process.argv[2] || 'http://127.0.0.1:8810';
const STUB=process.argv[3] || 'http://127.0.0.1:8899';
assert.equal(new globalThis.URL(APP).hostname,'127.0.0.1');
assert.equal(new globalThis.URL(STUB).hostname,'127.0.0.1');
const URL='https://bazarnow.xyz/@nafin-boutique';
const control=path=>fetch(STUB+path).then(r=>r.json());
let checks=0;
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS '+name);};
await mkdir('.local/sharing-shots',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--disable-component-update']});
const errors=[];
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
await context.addCookies([{name:'sb-access',value:'TEST',url:APP}]);
await context.route('**/*',route=>new globalThis.URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
await context.addInitScript(()=>{
 window.testClipboard=[];
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.testClipboard.push(text);}}});
 Object.defineProperty(navigator,'share',{configurable:true,writable:true,value:undefined});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
async function pixels(selector){return page.locator(selector).evaluate(canvas=>({width:canvas.width,height:canvas.height,data:Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)}));}
function decode(image){return jsQR(new Uint8ClampedArray(image.data),image.width,image.height,{inversionAttempts:'dontInvert'})?.data;}
try {
 await control('/__mode/shop');await control('/__plan/free');await control('/__products/0');
 const guest=await fetch(APP+'/app/qr',{redirect:'manual'});
 check('QR page requires login and remembers destination',guest.status===303&&guest.headers.get('location')==='/login?next=%2Fapp%2Fqr');
 await control('/__mode/noshop');
 const missing=await fetch(APP+'/app/qr',{headers:{cookie:'sb-access=TEST'},redirect:'manual'});
 check('seller without a shop cannot receive a foreign public QR',missing.status===303&&missing.headers.get('location')==='/onboarding');
 await control('/__mode/shop');
 const post=await fetch(APP+'/app/qr',{method:'POST',headers:{cookie:'sb-access=TEST'},redirect:'manual'});
 check('QR endpoint is read-only',post.status===405&&post.headers.get('allow')==='GET');
 await page.goto(APP+'/app');
 check('one existing copy control shows full canonical shop URL',await page.locator('#shop-copy').count()===1&&await page.locator('.seller-sharing__url').innerText()===URL);
 check('seller sees bio guidance without duplicated sharing controls',await page.locator('.seller-sharing__hint').innerText().then(t=>t.includes('TikTok')&&t.includes('Instagram'))&&await page.locator('.shop-sharing').count()===0);
 await page.locator('#shop-copy').click();
 check('copy uses complete public URL with small success confirmation',await page.evaluate(url=>testClipboard.at(-1)===url,URL)&&await page.locator('.share-status').innerText()==='لینکەکە کۆپی کرا');
 await page.screenshot({path:'.local/sharing-shots/owner-mobile.png',fullPage:true});
 await page.locator('#owner-management-toggle').click();
 await page.locator('#settings-open').click();
 check('existing Settings identity/subscription/profile/support/logout remain',await page.locator('.settings-identity').isVisible()&&await page.locator('#settings-subscription').isVisible()&&await page.locator('.settings-edit').isVisible()&&await page.locator('.settings-logout').isVisible()&&await page.getByText('پشتیوانی و یاسایی',{exact:true}).isVisible());
 await page.getByRole('link',{name:'کۆدی QR ـی دوکان',exact:true}).click();
 await page.waitForSelector('#shop-qr-canvas:not([hidden])');
 const response=await fetch(APP+'/app/qr?slug=someone-else&shop_id=foreign',{headers:{cookie:'sb-access=TEST'}});
 const html=await response.text();
 check('QR uses owned slug, ignores supplied shop and token parameters',response.status===200&&html.includes('data-url="'+URL+'"')&&!html.includes('someone-else')&&!html.includes('sb-access')&&!html.includes('TEST'));
 check('private QR page is no-store and not indexed',response.headers.get('cache-control')==='no-store'&&response.headers.get('x-robots-tag')==='noindex, nofollow');
 const image=await pixels('#shop-qr-canvas');
 check('independent decoder scans exact canonical URL',decode(image)===URL);
 check('print download uses at least 1200 square pixels',image.width>=1200&&image.width===image.height);
 const decoded=jsQR(new Uint8ClampedArray(image.data),image.width,image.height,{inversionAttempts:'dontInvert'});
 const modules=17+4*decoded.version,cell=image.width/(modules+8),margin=4*cell;
 let quietZone=Number.isInteger(cell);
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
  if(x<margin||y<margin||x>=image.width-margin||y>=image.height-margin){
   const offset=(y*image.width+x)*4;
   if(image.data[offset]!==255||image.data[offset+1]!==255||image.data[offset+2]!==255||image.data[offset+3]!==255)quietZone=false;
  }
 }
 check('opaque black/white contrast and four full quiet-zone modules on all sides',quietZone&&image.data.every((v,i)=>i%4===3?v===255:v===0||v===255));
 const downloadEvent=page.waitForEvent('download');await page.locator('#qr-download').click();const download=await downloadEvent;
 check('PNG has a safe shop-specific filename',download.suggestedFilename()==='bazaro-nafin-boutique-qr.png');
 const bytes=await readFile(await download.path());
 check('download is genuine PNG, not GIF or SVG',bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 const pngImage=await page.evaluate(async base64=>{
  const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,data:Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data)};
 },bytes.toString('base64'));
 check('downloaded PNG independently scans, with exact rendered pixel data',decode(pngImage)===URL&&createHash('sha256').update(new Uint8Array(pngImage.data)).digest('hex')===createHash('sha256').update(new Uint8Array(image.data)).digest('hex'));
 await page.locator('#share-btn').click();
 check('unsupported Native Share copies link using existing handler',await page.evaluate(url=>testClipboard.at(-1)===url,URL));
 await page.evaluate(()=>{navigator.share=async payload=>{window.shared=payload;};});
 await page.locator('#share-btn').click();
 check('supported Native Share receives only shop title and public URL',await page.evaluate(url=>shared.url===url&&Object.keys(shared).sort().join(',')==='title,url',URL));
 await page.evaluate(()=>{navigator.share=async()=>{throw new Error('unavailable');};});await page.locator('#share-btn').click();
 check('failed native share falls back to copying',await page.locator('.share-status').innerText()==='لینکەکە کۆپی کرا');
 await page.evaluate(()=>{window.beforeCancel=testClipboard.length;navigator.share=async()=>{throw new DOMException('cancelled','AbortError');};});
 await page.locator('#share-btn').click();
 check('cancelled native share creates no fallback side effect',await page.evaluate(()=>testClipboard.length===beforeCancel));
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('denied');}}});window.fallbackCopies=[];document.execCommand=command=>{fallbackCopies.push(document.querySelector('textarea').value);return command==='copy';};});
 await page.locator('#shop-copy').click();
 check('clipboard denial uses legacy copy fallback and restores focus',await page.evaluate(url=>fallbackCopies.at(-1)===url&&document.activeElement.id==='shop-copy',URL));
 await page.evaluate(()=>{document.execCommand=()=>false;});await page.locator('#shop-copy').click();
 check('copy failure is honest and keeps a selectable URL',await page.locator('.share-status').innerText()==='کۆپیکردن سەرکەوتوو نەبوو'&&await page.locator('.seller-sharing__url').isVisible());
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  check(width+' mobile RTL QR page fits viewport',await page.evaluate(()=>document.documentElement.dir==='rtl'&&document.documentElement.scrollWidth<=innerWidth));
  check(width+' primary/secondary controls have touch targets',await page.locator('#qr-download,#shop-copy,#share-btn').evaluateAll(elements=>elements.every(e=>e.getBoundingClientRect().height>=44)));
 }
 await page.setViewportSize({width:390,height:844});await page.goto(APP+'/app/qr');await page.waitForSelector('#shop-qr-canvas:not([hidden])');
 await page.screenshot({path:'.local/sharing-shots/qr-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'گەڕانەوە بۆ ڕێکخستن',exact:true}).click();
 check('QR Back retains Settings fragment and navigation',await page.locator('#account-settings').isVisible()&&await page.locator('.nav__tab').count()===3);
 await page.locator('#settings-back').click();
 check('Settings Back returns to existing owner controls',await page.locator('.owner-controls').isVisible());
 await page.goto(APP+'/app/profile');await page.locator('#copy-link').click();
 check('existing Profile copy uses same canonical public domain',await page.evaluate(url=>testClipboard.at(-1)===url,URL));
 const guestContext=await browser.newContext();await guestContext.route('**/*',r=>new globalThis.URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const customer=await guestContext.newPage();const publicResponse=await customer.goto(APP+'/@nafin-boutique');
 check('QR destination is a public shop without customer login',publicResponse.status()===200&&await customer.locator('.shop-name').isVisible()&&!customer.url().includes('/login'));
 check('customer WhatsApp and public sharing remain unchanged',await customer.locator('a[href^="https://wa.me/"]').count()>0&&await customer.locator('#shop-copy').count()===1&&await customer.locator('#share-btn').count()===1&&await customer.locator('.seller-sharing').count()===0);
 await guestContext.close();
 // Independent short, maximum-length and changed-slug renderings without production writes.
 let fixture={name:'دوکانی تاقیکردنەوە',slug:'abc'};
 await page.route(APP+'/__qr-fixture',route=>route.fulfill({contentType:'text/html',body:layout({title:'QR fixture',description:'Synthetic only',body:shopQrPage({shop:fixture}),scripts:['/js/vendor/qrcode-generator-2.0.4.js','/js/shop.js','/js/shop-qr.js']})}));
 for(const slug of ['abc','shop-'+ 'a'.repeat(35),'changed-shop']){
  fixture={...fixture,slug};await page.goto(APP+'/__qr-fixture');await page.waitForSelector('#shop-qr-canvas:not([hidden])');
  check('different/current shop slug independently scans: '+slug,decode(await pixels('#shop-qr-canvas'))===publicShopUrl(fixture));
 }
 check('printed-link change warning is present',await page.getByText(/کۆدە چاپکراوە کۆنەکان/).isVisible());
 const escaped=shopQrPage({shop:{name:'<img src=x onerror=alert(1)>',slug:'safe-shop'}});
 check('shop names are escaped in HTML and QR URL contains no private fields',escaped.includes('&lt;img')&&!escaped.includes('<img src=x')&&!publicShopUrl({slug:'safe-shop',token:'private'}).includes('private'));
 await page.route('**/js/vendor/qrcode-generator-2.0.4.js',r=>r.abort());await page.goto(APP+'/app/qr');
 check('missing QR library leaves copy usable and an honest error',await page.locator('#qr-download').isDisabled()&&await page.locator('#qr-status').innerText().then(t=>t.includes('سەرکەوتوو نەبوو'))&&await page.locator('#shop-copy').isEnabled());
 check('no browser JavaScript errors',errors.length===0);
 console.log('PASS shop sharing: '+checks+' checks');
}finally{await control('/__mode/shop');await browser.close();}
