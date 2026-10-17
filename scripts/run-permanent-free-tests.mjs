import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,createWriteStream,openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);mkdirSync('.local',{recursive:true});
const APP='http://127.0.0.1:8810',STUB='http://127.0.0.1:8899';
const env={...process.env,WRANGLER_SEND_METRICS:'false',
  XDG_CONFIG_HOME:root+'.local/xdg',WRANGLER_LOG_PATH:root+'.local/wrangler.log',
  WAYL_RETURN_URL:'https://staging.bazaro.test/app/subscription/result',
  CHROME:process.env.CHROME || (process.platform==='win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined)};
const config={name:'bazaro-isolated-free-test',main:'../worker/index.js',compatibility_date:'2026-08-01',compatibility_flags:['nodejs_compat'],
  assets:{directory:'../public',binding:'ASSETS',not_found_handling:'none'},
  r2_buckets:[{binding:'IMAGES',bucket_name:'bazaro-synthetic-images',remote:false}],
  vars:{SUPABASE_URL:STUB,SUPABASE_PUBLISHABLE_KEY:'stub',SUPABASE_SERVICE_ROLE_KEY:'stub-service-key',
    WAYL_API_BASE:STUB,WAYL_API_TOKEN:'stub-wayl-token',WAYL_ENV:'test',PAYMENTS_ENABLED:'true',
    WAYL_RETURN_URL:env.WAYL_RETURN_URL,TELEGRAM_API_BASE:STUB,TELEGRAM_BOT_TOKEN:'stub-bot',
    TELEGRAM_ADMIN_CHAT_ID:'12345',TELEGRAM_WEBHOOK_SECRET:'stub-telegram-secret',TURNSTILE_SITE_KEY:'',VIEW_SALT:'stub-salt'}};
writeFileSync('.local/wrangler-test.json',JSON.stringify(config,null,2));
const servers=[],logs=[];
// Each release check gets a fresh R2 namespace. Reusing the previous run's
// persistent state makes missing-upload fixtures collide with real test uploads.
// Keep the path short for the Windows native R2/SQLite runtime.
const statePath='.local/r-'+randomUUID().slice(0,8);
async function reachable(url) {try {await fetch(url,{signal:AbortSignal.timeout(500)});return true;}catch{return false;}}
function server(args,name) {
  const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log=createWriteStream('.local/'+name+'.log');child.stdout.pipe(log);child.stderr.pipe(log);
  servers.push(child);logs.push(log);return child;
}
async function ready(url,child) {
  for(let n=0;n<100;n++) {
    if(child.exitCode!==null) throw new Error('Local server exited; inspect .local logs');
    if(await reachable(url)) return;await delay(200);
  }
  throw new Error('Local server startup timed out');
}
const results=[];
const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
if(only && !['seo','worker','wayl','retry','profile','publish','currency','visibility','affected','grants','owner','browser','sharing','categories','category-ui'].includes(only))
  throw new Error('Unknown isolated suite selector');
async function run(name,args) {
  // Keep draining the local servers' output while tests run. spawnSync blocks
  // those pipes and can destabilize a busy local Windows Worker runtime.
  const output=openSync('.local/'+name+'-results.txt','w');
  let status;
  try {
    const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore',output,output]});
    [status]=await once(child,'close');
  } finally {closeSync(output);}
  const ok=status===0;results.push({name,ok,status});
  console.log((ok?'PASS ':'FAIL ')+name);
}
try {
  if(await reachable(APP) || await reachable(STUB)) throw new Error('Test ports in use. Stop prior local test servers before running this isolated suite.');
  if(!only) {
    await run('database',['--test','scripts/permanent-free-db-test.mjs','scripts/permanent-free-integration-db-test.mjs','scripts/permanent-free-regression-test.mjs']);
    await run('image-sitemap',['--test','scripts/image-sitemap-test.mjs']);
    await run('owner-profile-ui',['scripts/owner-profile-ui-test.mjs']);
    await run('plan-state',['--test','scripts/plan-state-test.mjs']);
    await run('limits',['scripts/plan-limits-test.mjs']);await run('hardening',['scripts/security-hardening-test.mjs']);
  }
  const stub=server(['scripts/stub-supabase.mjs'],'stub');await ready(STUB+'/__mode/shop',stub);
  const worker=server(['node_modules/wrangler/bin/wrangler.js','dev','--config','.local/wrangler-test.json','--local','--port','8810','--ip','127.0.0.1','--persist-to',statePath],'worker');
  await ready(APP,worker);
  for(const [name,file] of [
    ['seo','seo-test.mjs'],
    ['categories','categories-test.mjs'],['category-ui','category-ui-test.mjs'],
    ['worker','permanent-free-worker-test.mjs'],
    ['wayl','wayl-test.mjs'],['retry','checkout-retry-test.mjs'],
    ['profile','profile-test.mjs'],['publish','publish-flow-test.mjs'],
    ['currency','product-currency-test.mjs'],['visibility','visibility-test.mjs'],
    ['affected','affected-rows-test.mjs'],['grants','admin-grants-test.mjs'],
    ['owner','owner-product-controls-test.mjs'],['browser','permanent-free-browser-test.mjs'],
    ['sharing','shop-sharing-test.mjs'],
  ]) {
    if(only && only!==name) continue;
    // Every suite starts from a known synthetic baseline, independent of the
    // preceding suite's controls. No remote data is ever read or written.
    for(const path of ['/__mode/shop','/__rows/1','/__noproduct/0','/__mixed/0','/__suspended/0','/__admin/0','/__admin-active/1','/__intent/none','/__products/0','/__plan/free','/__trial/-100','/__sub/20','/__wayl/reset']) await fetch(STUB+path);
    await run(name,['scripts/'+file,APP,STUB]);
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
finally {
  for(const child of servers.reverse()) {
    if(child.exitCode!==null) continue;
    if(process.platform==='win32') {try {execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}
    else child.kill('SIGTERM');
  }
  logs.forEach(log=>log.end());
  writeFileSync('.local/test-summary.json',JSON.stringify(results,null,2));
}
if(results.some(r=>!r.ok)) process.exitCode=1;
