-- ============================================================
-- Bazaro — the first month is free: what the database guarantees
--
-- These are the rules of migration 20260927090000_first_month_free.sql,
-- written as assertions and run against a real Postgres. The Worker
-- suite scripts/first-month-free-test.mjs proves the screens; this
-- proves the calendar, and the calendar is the part where a mistake
-- costs somebody money.
--
-- To run it, replay every migration in supabase/migrations into an
-- empty database — a Supabase shadow database, or a local cluster with
-- an auth.users table and the anon/authenticated/service_role roles —
-- and then:
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/first_month_free_test.sql
--
-- The last two statements print one line per check and a total. It is
-- meant to be read, not just to exit 0.
--
-- What it covers: the thirty days and that they are exactly thirty; one
-- free month per account, surviving a deleted shop and a changed email;
-- a plan bought mid-trial starting when the trial ends rather than on
-- the day it was paid for; nothing stacking, at the checkout or at the
-- webhook; a duplicate webhook adding nothing; the two prices; no
-- public one-month plan; and that the month running out deletes no
-- product, hides no product row, and locks nobody out of their account.
-- ============================================================



create table results (n serial, name text, got text, want text);
create or replace function chk(p_name text, p_got text, p_want text) returns void
language sql as $$ insert into results (name, got, want) values (p_name, p_got, p_want) $$;
create or replace function seller(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',u)::text, false); end $$;
create or replace function svc() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); end $$;

insert into auth.users (id, email) values ('aa000001-0000-4000-8000-000000000001','new@e.com');
select seller('aa000001-0000-4000-8000-000000000001');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc000001-0000-4000-8000-000000000001','aa000001-0000-4000-8000-000000000001','New','new-shop','9647510000011','active');

select chk('01 a new shop is on the free month',
  (select plan||'/'||status from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001'),'trial/trialing');
select chk('02 the free month is exactly 30 days',
  (select round(extract(epoch from (trial_ends_at-started_at))/86400)::text from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001'),'30');
select chk('03 expires_at is the trial end, so there is one date not two',
  (select (expires_at=trial_ends_at)::text from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001'),'true');
select chk('04 the trial reads active', app.on_trial('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('05 the tier is trial', app.plan_tier('cc000001-0000-4000-8000-000000000001'),'trial');
select chk('06 the shop is public', app.shop_is_public('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('07 and may publish', app.can_publish('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('08 nothing is scheduled yet', app.paid_scheduled('cc000001-0000-4000-8000-000000000001')::text,'false');
select chk('09 the trial limit is 5 products', app.free_product_limit()::text,'5');
select chk('10 and 1 image per product', app.free_image_limit()::text,'1');
select chk('11 six months costs exactly 38,000', app.plan_price('months_6')::text,'38000');
select chk('12 one year costs exactly 72,000', app.plan_price('year_1')::text,'72000');
select count(*) from results;



-- ===== 13-15: buying six months during the free month =====
-- The trial end is captured first so the assertion compares against the
-- date the seller could actually see, not against now().
create table t1 as select trial_ends_at from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001';
select svc();
select public.admin_apply_payment('cc000001-0000-4000-8000-000000000001','months_6',38000,'wayl','REF-1','test');

select chk('13 six months bought mid-trial runs from the trial end, not from today',
  (select (sub.expires_at = t1.trial_ends_at + interval '6 months')::text
     from public.subscriptions sub, t1 where sub.shop_id='cc000001-0000-4000-8000-000000000001'),'true');
select chk('14 the free month is not thrown away: trial_ends_at is untouched',
  (select (sub.trial_ends_at = t1.trial_ends_at)::text from public.subscriptions sub, t1
    where sub.shop_id='cc000001-0000-4000-8000-000000000001'),'true');
select chk('15 the seller is still on the free month today',
  app.on_trial('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('16 and the plan reads as scheduled, not running',
  app.paid_scheduled('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('17 the tier stays trial until the free month ends',
  app.plan_tier('cc000001-0000-4000-8000-000000000001'),'trial');

-- ===== 18-19: no stacking =====
select seller('aa000001-0000-4000-8000-000000000001');
do $$ begin
  perform public.wayl_start_intent('cc000001-0000-4000-8000-000000000001','year_1','REF-STACK','live',repeat('s',40));
  perform chk('18 a second checkout is refused while a plan is scheduled','no error','SW008');
exception when sqlstate 'SW008' then perform chk('18 a second checkout is refused while a plan is scheduled','SW008','SW008');
end $$;
do $$ begin
  perform public.wayl_start_intent('cc000001-0000-4000-8000-000000000001','months_6','REF-STACK2','live',repeat('s',40));
  perform chk('19 and so is buying the same plan again','no error','SW008');
exception when sqlstate 'SW008' then perform chk('19 and so is buying the same plan again','SW008','SW008');
end $$;

-- ===== 20-22: a live paid plan cannot be extended by buying again =====
create table paid_shop as select 'cc000003-0000-4000-8000-000000000003'::uuid as id;
insert into auth.users (id, email) values ('aa000003-0000-4000-8000-000000000003','paid@e.com');
select seller('aa000003-0000-4000-8000-000000000003');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc000003-0000-4000-8000-000000000003','aa000003-0000-4000-8000-000000000003','Paid','paid-shop','9647510000013','active');
-- Put it past its free month and on a running paid plan.
update public.subscriptions set trial_ends_at = now() - interval '2 days',
  plan='months_6', status='active', expires_at = now() + interval '170 days'
 where shop_id='cc000003-0000-4000-8000-000000000003';
select chk('20 a shop past its free month on a paid plan reads paid',
  app.plan_tier('cc000003-0000-4000-8000-000000000003'),'paid');
select chk('21 and is not on a trial any more',
  app.on_trial('cc000003-0000-4000-8000-000000000003')::text,'false');
create table before_paid as select expires_at from public.subscriptions where shop_id='cc000003-0000-4000-8000-000000000003';
do $$ begin
  perform public.wayl_start_intent('cc000003-0000-4000-8000-000000000003','months_6','REF-EXT','live',repeat('s',40));
  perform chk('22 a running paid plan cannot be extended by buying again','no error','SW008');
exception when sqlstate 'SW008' then perform chk('22 a running paid plan cannot be extended by buying again','SW008','SW008');
end $$;
select chk('23 and its expiry did not move',
  (select (sub.expires_at = b.expires_at)::text from public.subscriptions sub, before_paid b
    where sub.shop_id='cc000003-0000-4000-8000-000000000003'),'true');

-- ===== 24: no public one-month plan =====
select seller('aa000003-0000-4000-8000-000000000003');
do $$ begin
  perform public.wayl_start_intent('cc000003-0000-4000-8000-000000000003','month_1','REF-M1','live',repeat('s',40));
  perform chk('24 there is no public one-month plan to buy','no error','refused');
exception when others then perform chk('24 there is no public one-month plan to buy','refused','refused');
end $$;



-- ===== the free month running out takes nothing with it =====
insert into auth.users (id, email) values ('aa000004-0000-4000-8000-000000000004','exp@e.com');
select seller('aa000004-0000-4000-8000-000000000004');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc000004-0000-4000-8000-000000000004','aa000004-0000-4000-8000-000000000004','Exp','exp-shop','9647510000014','active');
insert into public.products (id, shop_id, title, price, currency, status) values
  ('dd000001-0000-4000-8000-000000000001','cc000004-0000-4000-8000-000000000004','Alpha Product',1000,'IQD','active'),
  ('dd000002-0000-4000-8000-000000000002','cc000004-0000-4000-8000-000000000004','Beta Product',2000,'IQD','active'),
  ('dd000003-0000-4000-8000-000000000003','cc000004-0000-4000-8000-000000000004','Gamma Product',3000,'IQD','active');
insert into public.product_images (product_id, shop_id, r2_key, r2_key_full, position, content_type)
values ('dd000001-0000-4000-8000-000000000001','cc000004-0000-4000-8000-000000000004',
        'products/cc000004-0000-4000-8000-000000000004/a.webp',
        'products/cc000004-0000-4000-8000-000000000004/a-full.webp',1,'image/webp');

-- Wind the clock past the free month AND past the grace days.
update public.subscriptions
   set trial_ends_at = now() - interval '5 days', expires_at = now() - interval '5 days'
 where shop_id='cc000004-0000-4000-8000-000000000004';

select svc();
select public.expire_lapsed_subscriptions();

select chk('25 the free month running out marks the shop expired',
  (select status from public.subscriptions where shop_id='cc000004-0000-4000-8000-000000000004'),'expired');
select chk('26 no product was deleted',
  (select count(*)::text from public.products where shop_id='cc000004-0000-4000-8000-000000000004'),'3');
select chk('27 no product was even hidden — they are all still active',
  (select count(*)::text from public.products where shop_id='cc000004-0000-4000-8000-000000000004' and status='active'),'3');
select chk('28 no image was deleted',
  (select count(*)::text from public.product_images where shop_id='cc000004-0000-4000-8000-000000000004'),'1');
select chk('29 the shop row is still there',
  (select count(*)::text from public.shops where id='cc000004-0000-4000-8000-000000000004'),'1');
select chk('30 the account is still there',
  (select count(*)::text from auth.users where id='aa000004-0000-4000-8000-000000000004'),'1');
select chk('31 but nothing of it is public any more',
  app.shop_is_public('cc000004-0000-4000-8000-000000000004')::text,'false');
select chk('32 and no new product may be posted while nobody is paying',
  app.can_publish('cc000004-0000-4000-8000-000000000004')::text,'false');
select chk('33 the tier reads expired', app.plan_tier('cc000004-0000-4000-8000-000000000004'),'expired');

-- ===== buying after the free month ended =====
select chk('34 an expired shop holds no entitlement, so it may buy',
  app.has_paid_entitlement('cc000004-0000-4000-8000-000000000004')::text,'false');
select seller('aa000004-0000-4000-8000-000000000004');
create table intent4 as
  select * from public.wayl_start_intent('cc000004-0000-4000-8000-000000000004','months_6','REF-AFTER','live',repeat('s',40));
select chk('35 and a checkout really does start',
  (select (id is not null)::text from intent4),'true');
select chk('36 priced by the server at 38,000, whatever the browser said',
  (select (amount = 38000)::text from intent4), 'true');

-- ===== the duplicate webhook =====
select svc();
create table applied1 as
  select * from public.wayl_apply_payment((select id from intent4), 'REF-AFTER', 38000, 'FIB', 'first');
select chk('37 the first confirmation activates the plan',
  (select activated::text from applied1),'true');
create table exp1 as select expires_at from public.subscriptions where shop_id='cc000004-0000-4000-8000-000000000004';
select chk('38 paying after expiry runs from today, not from the old date',
  (select (e.expires_at > now() + interval '175 days')::text from exp1 e),'true');

create table applied2 as
  select * from public.wayl_apply_payment((select id from intent4), 'REF-AFTER', 38000, 'FIB', 'duplicate');
select chk('39 a duplicate webhook does not activate a second time',
  (select activated::text from applied2),'false');
select chk('40 it reports the plan as already active',
  (select already_active::text from applied2),'true');
select chk('41 and the expiry did not move by one second',
  (select (sub.expires_at = e.expires_at)::text from public.subscriptions sub, exp1 e
    where sub.shop_id='cc000004-0000-4000-8000-000000000004'),'true');
select chk('42 only one payment was ever recorded',
  (select count(*)::text from public.payments where shop_id='cc000004-0000-4000-8000-000000000004'),'1');
select chk('43 and the products are public again with nothing to restore by hand',
  app.shop_is_public('cc000004-0000-4000-8000-000000000004')::text,'true');
select chk('44 all three of them, still active',
  (select count(*)::text from public.products where shop_id='cc000004-0000-4000-8000-000000000004' and status='active'),'3');



-- ===== the free month cannot be restarted =====
-- The schema allows one shop per owner, so the only way to try for a
-- second trial is to delete the shop and make another. That is exactly
-- what trial_grants is keyed on auth.users.id to stop.
insert into auth.users (id, email) values ('aa000005-0000-4000-8000-000000000005','reset@e.com');
select seller('aa000005-0000-4000-8000-000000000005');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc000005-0000-4000-8000-000000000005','aa000005-0000-4000-8000-000000000005','Reset','reset-shop','9647510000015','active');
create table first_trial as select trial_ends_at from public.subscriptions where shop_id='cc000005-0000-4000-8000-000000000005';

-- Most of the month is spent.
update public.subscriptions set trial_ends_at = now() + interval '3 days', expires_at = now() + interval '3 days'
 where shop_id='cc000005-0000-4000-8000-000000000005';
update public.trial_grants set expires_at = now() + interval '3 days'
 where user_id='aa000005-0000-4000-8000-000000000005';

-- Delete the shop and start again. Same account.
delete from public.shops where id='cc000005-0000-4000-8000-000000000005';
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc000006-0000-4000-8000-000000000006','aa000005-0000-4000-8000-000000000005','Again','again-shop','9647510000016','active');

select chk('45 deleting the shop and making another does not restart the free month',
  (select round(extract(epoch from (trial_ends_at - now()))/86400)::text
     from public.subscriptions where shop_id='cc000006-0000-4000-8000-000000000006'),'3');
select chk('46 the ledger still holds exactly one grant for that account',
  (select count(*)::text from public.trial_grants where user_id='aa000005-0000-4000-8000-000000000005'),'1');
select chk('47 and a seller cannot write that ledger themselves',
  (select has_table_privilege('authenticated','public.trial_grants','INSERT')::text),'false');
select chk('48 nor read it',
  (select has_table_privilege('authenticated','public.trial_grants','SELECT')::text),'false');

-- Changing the email does not help: the ledger is keyed on the user id.
update auth.users set email='renamed@e.com' where id='aa000005-0000-4000-8000-000000000005';
select chk('49 changing the email does not restart it either',
  (select count(*)::text from public.trial_grants where user_id='aa000005-0000-4000-8000-000000000005'),'1');

-- ===== an expired shop keeps working for its owner =====
select seller('aa000004-0000-4000-8000-000000000004');
select chk('50 the owner can still read their own expired shop',
  (select count(*)::text from public.shops where id='cc000004-0000-4000-8000-000000000004'),'1');
select chk('51 and still see every product in it',
  (select count(*)::text from public.products where shop_id='cc000004-0000-4000-8000-000000000004'),'3');

-- ===== the admin grant path is untouched =====
-- The anti-stacking guard is deliberately NOT on admin_apply_payment:
-- a goodwill month or a refund is the owner's to give, and it must keep
-- working on a shop that is already on its free month.
select svc();
create table before_grant as select expires_at from public.subscriptions where shop_id='cc000006-0000-4000-8000-000000000006';
select public.admin_apply_payment('cc000006-0000-4000-8000-000000000006','month_1',0,'manual_grant','G-1','goodwill');
select chk('52 the owner can still grant a month by hand on a shop mid-trial',
  (select count(*)::text from public.payments
    where shop_id='cc000006-0000-4000-8000-000000000006' and plan='month_1' and method='manual_grant'),'1');
select chk('53 and that grant really did extend the shop',
  (select (sub.expires_at > b.expires_at)::text from public.subscriptions sub, before_grant b
    where sub.shop_id='cc000006-0000-4000-8000-000000000006'),'true');
select chk('54 a granted month is still not something a seller can buy',
  (select count(*)::text from public.payment_intents where plan='month_1' and source='payment'),'0');



-- ===== the grace days apply to the free month too =====
-- Not a new mechanism: subscriptions.grace_days has always been 3, and
-- the free month's expires_at goes through the same predicate as a paid
-- plan's. So the entitlement is exactly 30 days and public visibility
-- has the usual 3 days of slack on the end of it.
insert into auth.users (id, email) values ('aa000007-0000-4000-8000-000000000007','grace@e.com');
select seller('aa000007-0000-4000-8000-000000000007');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc000007-0000-4000-8000-000000000007','aa000007-0000-4000-8000-000000000007','Grace','grace-shop','9647510000017','active');
insert into public.products (id, shop_id, title, price, currency, status)
values ('dd000007-0000-4000-8000-000000000007','cc000007-0000-4000-8000-000000000007','Grace Item',1000,'IQD','active');

update public.subscriptions set trial_ends_at = now() - interval '1 day', expires_at = now() - interval '1 day'
 where shop_id='cc000007-0000-4000-8000-000000000007';
select chk('55 one day after the free month the products are still public (grace)',
  app.shop_is_public('cc000007-0000-4000-8000-000000000007')::text,'true');
select chk('56 but nothing new may be posted during grace',
  app.can_publish('cc000007-0000-4000-8000-000000000007')::text,'false');

update public.subscriptions set expires_at = now() - interval '4 days'
 where shop_id='cc000007-0000-4000-8000-000000000007';
select chk('57 four days after, past the three grace days, they are not',
  app.shop_is_public('cc000007-0000-4000-8000-000000000007')::text,'false');
select chk('58 and the product row is still there, untouched',
  (select status from public.products where id='dd000007-0000-4000-8000-000000000007'),'active');

-- ===== the grace window is the one the schema always had =====
select chk('59 the free month uses the same grace days as a paid plan',
  (select grace_days::text from public.subscriptions where shop_id='cc000007-0000-4000-8000-000000000007'),'3');

-- ---------- the report ----------
select case when got is not distinct from want then 'PASS  ' else 'FAIL  ' end || name ||
  case when got is not distinct from want then ''
       else E'\n        got  ' || coalesce(got,'NULL') || E'\n        want ' || coalesce(want,'NULL') end as line
from results order by n;

select count(*) filter (where got is not distinct from want)::text
       || ' of ' || count(*)::text || ' passed' as summary
from results;
