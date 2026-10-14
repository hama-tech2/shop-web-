import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture } from './database-fixture.mjs';
const owner='30000000-0000-4000-8000-000000000001';
const stranger='30000000-0000-4000-8000-000000000002';
const shop='40000000-0000-4000-8000-000000000001';
const id=n=>'50000000-0000-4000-8000-'+String(n).padStart(12,'0');
const values={title:'Synthetic product',price:1000,currency:'IQD',status:'active',visibility:'everyone',description:null,category_id:null,platform_category_id:null};
const images=(n,count=5)=>Array.from({length:count},(_,i)=>({card:`products/${shop}/${id(n)}/${i}-card.webp`,full:`products/${shop}/${id(n)}/${i}-full.webp`}));
test('atomic owner RPCs execute PostgreSQL transactions and RLS with isolated data',async t=>{
  const db=await databaseFixture(); t.after(()=>db.close());
  await db.query('insert into auth.users(id) values ($1),($2)',[owner,stranger]);
  await db.query("insert into public.shops(id,owner_id,slug,name,whatsapp) values ($1,$2,'atomic-fixture','Synthetic','+9647000000000')",[shop,owner]);
  const actor=async who=>{await db.exec('begin; set local role authenticated');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:who})]);};
  const publish=(n,list=images(n))=>db.query('select public.publish_product($1,$2,$3,$4)',[id(n),shop,values,list]);
  const denial=async (fn,code)=>{await db.exec('savepoint nope');await assert.rejects(fn,e=>e.code===code);await db.exec('rollback to savepoint nope; release savepoint nope');};
  await actor(owner);
  await t.test('image failure rolls the whole product back',async()=>{
    await denial(()=>publish(1,images(1,6)),'23514');
    // Two identical keys fail inside save_product_images AFTER the product
    // insert, proving transaction rollback rather than only pre-validation.
    await denial(()=>publish(1,[images(1)[0],images(1)[0]]),'21000');
    assert.equal((await db.query('select count(*)::int n from public.products')).rows[0].n,0);
  });
  await t.test('five atomic publishes and retry at full quota work; sixth is blocked',async()=>{
    for(let n=1;n<=5;n++) await publish(n);
    await publish(5);
    await denial(()=>publish(6),'SW001');
    assert.equal((await db.query('select count(*)::int n from public.products')).rows[0].n,5);
    assert.equal((await db.query('select count(*)::int n from public.product_images')).rows[0].n,25);
  });
  await t.test('conflicting draft retry is rejected without overwriting',async()=>{
    await denial(()=>db.query('select public.publish_product($1,$2,$3,$4)',[id(5),shop,{...values,title:'Different'},images(5)]),'22023');
  });
  await t.test('gallery failure rolls back a title/status edit',async()=>{
    await denial(()=>db.query('select public.update_product($1,$2,$3)',[id(1),{...values,title:'Changed',status:'hidden'},images(1,6)]),'23514');
    assert.equal((await db.query('select title,status from public.products where id=$1',[id(1)])).rows[0].title,values.title);
  });
  await t.test('status changes preserve Home preference and do not release storage',async()=>{
    await db.query('select public.update_product($1,$2,$3)',[id(1),{title:values.title,status:'archived',visibility:'profile'},images(1)]);
    await denial(()=>publish(6),'SW001');
    const row=(await db.query('select * from public.owner_products($1)',[shop])).rows;
    assert.equal(row.length,5); assert.equal(row.filter(r=>r.owner_products.publicly_eligible).length,4);
    assert.equal(row[0].owner_products.product_images.length,5);
  });
  await db.exec('commit');
  await t.test('strangers cannot read owner stock, publish or edit; anon cannot call RPC',async()=>{
    await actor(stranger);
    await denial(()=>db.query('select * from public.owner_products($1)',[shop]),'42501');
    await denial(()=>publish(6),'42501');
    await denial(()=>db.query('select public.update_product($1,$2,$3)',[id(2),values,images(2)]),'42501');
    await db.exec('rollback; begin; set local role anon');
    await denial(()=>publish(6),'42501'); await db.exec('rollback');
  });
  await t.test('expiry requires no cleanup and upgrading restores only active candidates',async()=>{
    await db.query("update public.subscriptions set plan='months_6',status='active',paid_starts_at=now()-interval '1 day',expires_at=now()+interval '1 day' where shop_id=$1",[shop]);
    await actor(owner); await publish(6); await publish(7); await db.exec('commit');
    await db.query("update public.subscriptions set expires_at=now()-interval '4 days' where shop_id=$1",[shop]);
    await actor(owner);
    const retained=(await db.query('select * from public.owner_products($1)',[shop])).rows;
    assert.equal(retained.length,7); assert.equal(retained.filter(r=>r.owner_products.publicly_eligible).length,5);
    await db.exec('commit');
    await db.query("update public.subscriptions set expires_at=now()+interval '180 days' where shop_id=$1",[shop]);
    await actor(owner);
    assert.equal((await db.query('select * from public.owner_products($1)',[shop])).rows.filter(r=>r.owner_products.publicly_eligible).length,6);
    await db.exec('commit');
    assert.equal((await db.query('select count(*)::int n from public.product_images')).rows[0].n,35);
  });
});
