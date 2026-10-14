import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { PLANS, MAX_IMAGES, WAYL } from '../worker/config.js';
import { signatureValid, mapStatus } from '../worker/wayl.js';

const BASE = '357d458fc1bb073918b79574fc8a65fb872d9688';
const root = fileURLToPath(new URL('../',import.meta.url));
const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();

test('historical migrations, deployment configuration and Wayl provider adapter remain unchanged', () => {
  const historical=git('ls-tree','-r','--name-only',BASE,'supabase/migrations').split('\n');
  assert.equal(historical.length,45);
  assert.equal(git('diff',BASE,'--',...historical,'worker/wayl.js','worker/cron.js','wrangler.jsonc','supabase/config.toml'), '');
  const files=readdirSync(new URL('../supabase/migrations/',import.meta.url));
  assert.equal(files.filter(f=>f.endsWith('.sql')).length,46);
});

test('new migration is forward-only, transactional and contains no product/image/history backfill', () => {
  const file=readdirSync(new URL('../supabase/migrations/',import.meta.url))
    .find(f=>f.endsWith('_permanent_free_subscription.sql'));
  const sql=readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8');
  assert.match(sql,/\bbegin;/i); assert.match(sql,/commit;\s*$/i);
  const outsideFunctions = sql.replace(/create(?:\s+or\s+replace)?\s+function[\s\S]*?\$\$;/gi, '');
  assert.doesNotMatch(outsideFunctions,/\b(update|delete\s+from|insert\s+into)\s+public\.(products|product_images|trial_grants|shops|profiles|subscriptions|payments)\b/i);
  assert.doesNotMatch(sql,/create\s+or\s+replace\s+function\s+(app\.plan_price\b|app\.set_intent_price\b)/i);
});

test('the existing two public prices, five-image maximum and no monthly checkout stay unchanged', () => {
  assert.deepEqual(PLANS.map(p=>[p.key,p.amount]),[['year_1',9000],['months_6',5000]]);
  assert.equal(MAX_IMAGES,5); assert.equal(WAYL.currency,'IQD');
});

test('unchanged Wayl HMAC rejects tampered bytes/signatures and unknown statuses stay pending', async () => {
  const secret='synthetic-test-secret';
  const raw=JSON.stringify({referenceId:'FIXTURE-HMAC',status:'Paid'});
  const signature=createHmac('sha256',secret).update(raw).digest('hex');
  assert.equal(await signatureValid(secret,raw,signature),true);
  assert.equal(await signatureValid(secret,raw+' ',signature),false);
  assert.equal(await signatureValid('wrong-secret',raw,signature),false);
  assert.equal(await signatureValid(secret,raw,'bad'),false);
  assert.equal(mapStatus('unknown-new-provider-status'),'pending');
});
