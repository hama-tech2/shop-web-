import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {databaseFixture} from './database-fixture.mjs';
const migration=readFileSync(new URL('../supabase/migrations/20261022120000_free_thirty_products.sql',import.meta.url),'utf8');
const owner='30000000-0000-4000-8000-000000000001',shop='40000000-0000-4000-8000-000000000001';
const id=n=>'60000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function seed(db){await db.query('insert into auth.users(id) values ($1)',[owner]);await db.query("insert into public.shops(id,owner_id,slug,name,whatsapp) values ($1,$2,'thirty-fixture','Synthetic','+9647000000000')",[shop,owner]);}
async function actor(db,role='authenticated',sub=owner){await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,sub})]);}
async function denied(db,fn,code){await db.exec('savepoint denial');await assert.rejects(fn,e=>e.code===code);await db.exec('rollback to savepoint denial; release savepoint denial');}
async function insert(db,n,status='active'){await db.query("insert into public.products(id,shop_id,title,price,status,visibility,sort_order) values ($1,$2,'Synthetic',1000,$3,$4,$5)",[id(n),shop,status,n===1?'profile':'everyone',n]);}
async function snapshot(db){const out={};for(const {table_schema:s,table_name:t} of (await db.query("select table_schema,table_name from information_schema.tables where table_schema in ('auth','public') and table_type='BASE TABLE' order by 1,2")).rows)out[s+'.'+t]=(await db.query(`select to_jsonb(t) row from ${s}.${t} t`)).rows.map(r=>JSON.stringify(r.row)).sort();return out;}
async function definitions(db){return(await db.query("select p.oid::text,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public') and p.oid <> 'app.free_product_limit()'::regprocedure order by p.oid")).rows;}

test('thirty-product forward migration preserves all rows, paid dates/grace and every other function/permission',async t=>{
 const db=await databaseFixture({through:'20261013205746_permanent_free_subscription.sql'});t.after(()=>db.close());await seed(db);
 await db.query("update public.subscriptions set plan='months_6',status='active',paid_starts_at=now()-interval '1 day',expires_at=now()+interval '180 days',grace_days=7 where shop_id=$1",[shop]);
 for(let n=1;n<=33;n++){await insert(db,n,n===32?'hidden':n===33?'archived':'active');await db.query('insert into public.product_images(product_id,shop_id,r2_key,position) values($1,$2,$3,1)',[id(n),shop,`products/${shop}/${id(n)}/card.webp`]);}
 const before=await snapshot(db), functions=await definitions(db),acl=await scalar(db,"select proacl::text from pg_proc where oid='app.free_product_limit()'::regprocedure");
 await assert.rejects(db.exec(migration.replace(/commit;\s*$/i,'select 1/0; commit;')),e=>e.code==='22012');await db.exec('rollback');assert.equal(await scalar(db,'select app.free_product_limit()'),5);
 await db.exec(migration);assert.deepEqual(await snapshot(db),before);assert.deepEqual(await definitions(db),functions);assert.equal(await scalar(db,"select proacl::text from pg_proc where oid='app.free_product_limit()'::regprocedure"),acl);
 assert.equal(await scalar(db,'select app.free_product_limit()'),30);assert.equal(await scalar(db,'select app.free_image_limit()'),5);
 await db.exec('begin');await actor(db,'anon');assert.equal(await scalar(db,'select count(*)::int from public.products'),31);await db.exec('rollback');
 await db.query("update public.subscriptions set expires_at=now()-interval '4 days',grace_days=7 where shop_id=$1",[shop]);
 await db.exec('begin');await actor(db,'anon');assert.equal(await scalar(db,'select count(*)::int from public.products'),31);await db.exec('rollback');
 await db.query("update public.subscriptions set grace_days=3 where shop_id=$1",[shop]);
 const expiredSnapshot=await snapshot(db);
 await db.exec('begin');await actor(db,'anon');assert.deepEqual((await db.query('select id from public.products order by sort_order')).rows.map(r=>r.id),Array.from({length:30},(_,n)=>id(n+1)));assert.equal(await scalar(db,'select count(*)::int from public.product_images'),30);assert.equal(await scalar(db,'select app.product_is_public($1)',[id(31)]),false);await db.exec('rollback');
 assert.deepEqual(await snapshot(db),expiredSnapshot,'public fallback never rewrites visibility/status or deletes surplus');
 await db.exec('begin');await actor(db);assert.equal(await scalar(db,'select count(*)::int from public.products'),33);await denied(db,()=>insert(db,34),'SW001');await db.query("update public.products set title='Retained editable' where id=$1",[id(31)]);await db.exec('commit');
 await db.query("update public.subscriptions set expires_at=now()+interval '180 days' where shop_id=$1",[shop]);await db.exec('begin');await actor(db,'anon');assert.equal(await scalar(db,'select count(*)::int from public.products'),31);await db.exec('rollback');
 for(const status of ['suspended','banned']){await db.query('update public.shops set status=$1 where id=$2',[status,shop]);await db.exec('begin');await actor(db,'anon');assert.equal(await scalar(db,'select count(*)::int from public.products'),0);await db.exec('rollback');}
 assert.equal(await scalar(db,'select count(*)::int from public.products'),33);assert.equal(await scalar(db,'select count(*)::int from public.product_images'),33);
});

test('new Free shop stores thirty including hidden/archived; thirty-first refused; deletion releases one slot',async t=>{
 const db=await databaseFixture();t.after(()=>db.close());await seed(db);await db.exec('begin');await actor(db);
 let state=(await db.query('select * from public.subscription_state($1)',[shop])).rows[0];assert.equal(state.slots_left,30);assert.equal(state.expires_at,null);assert.equal(state.tier,'free');
 for(let n=1;n<=30;n++)await insert(db,n,n===29?'hidden':n===30?'archived':'active');
 state=(await db.query('select * from public.subscription_state($1)',[shop])).rows[0];assert.equal(state.can_publish,false);assert.equal(state.slots_left,0);await denied(db,()=>insert(db,31),'SW001');
 await db.query("update public.products set status='hidden',visibility='profile' where id=$1",[id(1)]);await denied(db,()=>insert(db,31),'SW001');
 await db.query('delete from public.products where id=$1',[id(1)]);assert.equal(await scalar(db,'select public.product_slots_left($1)',[shop]),1);await insert(db,31);assert.equal(await scalar(db,'select count(*)::int from public.products'),30);await denied(db,()=>insert(db,32),'SW001');
 await db.exec('commit');
});

test('historical paid one-month entitlement and stored grace survive quota growth; compatibility guard rejects drift',async t=>{
 const db=await databaseFixture({through:'20261013205746_permanent_free_subscription.sql'});t.after(()=>db.close());await seed(db);await db.query("update public.subscriptions set plan='month_1',status='active',paid_starts_at=now()-interval '1 day',expires_at=now()+interval '20 days',grace_days=7 where shop_id=$1",[shop]);
 const before=await snapshot(db);await db.exec(migration);assert.deepEqual(await snapshot(db),before);
 await db.exec('begin');await actor(db);const state=(await db.query('select * from public.subscription_state($1)',[shop])).rows[0];assert.equal(state.tier,'paid');assert.equal(state.plan,'month_1');await db.exec('rollback');
 await db.exec('create or replace function app.free_image_limit() returns int language sql immutable as $$ select 4; $$;');await assert.rejects(db.exec(migration),/Unexpected Free quota schema/);await db.exec('rollback');assert.equal(await scalar(db,'select app.free_product_limit()'),30);
});

test('prepared quota reads refresh after the helper changes from five to thirty',async t=>{
 const db=await databaseFixture({through:'20261013205746_permanent_free_subscription.sql'});t.after(()=>db.close());await seed(db);
 for(let n=1;n<=5;n++)await insert(db,n);
 await db.exec(`prepare quota_check as select public.product_slots_left('${shop}'::uuid) as slots,app.can_publish('${shop}'::uuid) as publish`);
 await db.exec('begin');await actor(db);let row=(await db.query('execute quota_check')).rows[0];assert.equal(row.slots,0);assert.equal(row.publish,false);await db.exec('commit');
 await db.exec(migration);
 await db.exec('begin');await actor(db);row=(await db.query('execute quota_check')).rows[0];assert.equal(row.slots,25);assert.equal(row.publish,true);await db.exec('rollback');
 await db.exec('begin');await actor(db);assert.equal(await scalar(db,'select plan from public.subscriptions where shop_id=$1',[shop]),'free');await db.exec('rollback');
 await db.exec('begin');await actor(db,'authenticated',id(99));assert.equal(await scalar(db,'select count(*)::int from public.subscriptions where shop_id=$1',[shop]),0);await db.exec('rollback');
});
