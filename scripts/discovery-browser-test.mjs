import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const app=process.argv[2] || 'http://127.0.0.1:8810';
assert.equal(new URL(app).hostname,'127.0.0.1','synthetic local tests only');
const browser=await chromium.launch({executablePath:process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking']});
let checks=0;
const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS '+name);};
await mkdir('.local/organic-audit',{recursive:true});
try {
 const context=await browser.newContext({javaScriptEnabled:false});
 const page=await context.newPage();
 // No provider calls or third-party fonts are necessary to verify the UI.
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(app).origin?r.continue():r.abort());
 for(const width of [320,360,390,430,1280]){
  await page.setViewportSize({width,height:900});
  await page.goto(app+'/');
  const learn=page.locator('a[href="/free-shop"]');
  check(width+' homepage explanation link is visible without JS',await learn.isVisible());
  check(width+' homepage explanation touch target at least 44px',(await learn.boundingBox()).height>=44);
  await learn.click();
  check(width+' public landing opens without authentication',new URL(page.url()).pathname==='/free-shop');
  check(width+' Sorani RTL is retained',await page.locator('html').getAttribute('dir')==='rtl');
  check(width+' no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(width+' one descriptive main heading',await page.locator('main h1').count()===1);
  const signup = page.locator('a[href="/signup"]');
  const box = await signup.boundingBox();
  if (box.height < 44) console.log('Touch target diagnostic', JSON.stringify({width,box,style:await signup.evaluate(e=>({minHeight:getComputedStyle(e).minHeight,display:getComputedStyle(e).display,transform:getComputedStyle(e).transform}))}));
  check(width+' signup touch target at least 44px',box.height>=44);
  check(width+' navigation retains exactly three tabs',await page.locator('.nav__tab').count()===3);
  await page.screenshot({path:'.local/organic-audit/landing-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});
 await page.goto(app+'/?category=clothing');
 check('filtered feed stays focused on products',await page.locator('a[href="/free-shop"]').count()===0);
 await page.goto(app+'/free-shop');
 await page.locator('a[href="/signup"]').click();
 check('existing signup flow opens',new URL(page.url()).pathname==='/signup');
 await context.close();
 console.log(checks+'/'+checks+' discovery browser checks passed');
}finally{await browser.close();}
