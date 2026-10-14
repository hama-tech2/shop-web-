import test from 'node:test';
import assert from 'node:assert/strict';
import {planState,bannerFor,daysUntil} from '../worker/plan-state.js';
import {PLAN_BANNER,PLANS} from '../worker/config.js';
const now=Date.parse('2026-10-14T00:00:00Z');
const at=n=>new Date(now+n*86400000).toISOString();
test('permanent Free ignores historical dates and has no warnings or countdown',()=>{
  for(const expiry of [null,at(-1000),at(60)]) {
    const plan=planState({tier:'free',plan:'free',status:'free',expires_at:expiry},false,now);
    assert.equal(plan.key,'free');assert.equal(plan.days,0);assert.equal(bannerFor(plan,PLAN_BANNER),null);
  }
});
test('missing state fails closed and no invalid/null date becomes epoch',()=>{
  assert.equal(planState(null).key,'unknown');
  assert.equal(planState({plan:'trial',status:'trialing'}).key,'unknown');
  assert.equal(daysUntil(null),null);assert.equal(daysUntil('bad'),null);
});
test('independent restriction precedes every entitlement and schedule',()=>{
  assert.equal(planState({tier:'restricted',paid_scheduled:true,in_grace:true}).key,'suspended');
});
test('legacy paid schedules and paid grace stay explicit',()=>{
  const scheduled=planState({tier:'free',paid_scheduled:true,plan:'months_6',trial_days_left:12},false,now);
  assert.equal(scheduled.key,'scheduled');assert.equal(scheduled.days,12);
  assert.equal(bannerFor(scheduled,PLAN_BANNER),null);
  const grace=planState({tier:'free',in_grace:true,grace_ends_at:at(2)},false,now);
  assert.equal(grace.key,'grace');assert.deepEqual(bannerFor(grace,PLAN_BANNER),{kind:'grace',days:2,dismissible:false});
});
test('paid warning thresholds, cooldown and pending confirmation remain functional',()=>{
  for(const [days,kind] of [[100,null],[14,'soon'],[7,'soon'],[3,'urgent'],[1,'urgent']]) {
    const plan=planState({tier:'paid',days_left:days,expires_at:at(days)},false,now);
    assert.equal(plan.key,'active');assert.equal(bannerFor(plan,PLAN_BANNER,{},now)?.kind ?? null,kind);
  }
  const p=planState({tier:'paid',days_left:7},false,now);
  assert.equal(bannerFor(p,PLAN_BANNER,{soon:at(-1)},now),null);
  assert.equal(bannerFor(p,PLAN_BANNER,{soon:at(-4)},now).kind,'soon');
  assert.equal(planState({tier:'paid',days_left:7},true).key,'pending');
});
test('only approved public prices are offered',()=>{
  assert.deepEqual(PLANS.map(p=>[p.key,p.amount]),[['year_1',9000],['months_6',5000]]);
});
