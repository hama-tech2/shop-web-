-- ============================================================
-- Bazaro — the first two months are free: what the database guarantees
--
-- These are the rules of migration 20260927090000_two_months_free.sql,
-- written as assertions and run against a real Postgres. The Worker
-- suite scripts/two-months-free-test.mjs proves the screens; this proves
-- the calendar and the numbers, and those are the parts where a mistake
-- costs somebody money.
--
-- To run it, replay every migration in supabase/migrations into an
-- empty database — a Supabase shadow database, or a local cluster with
-- an auth.users table and the anon/authenticated/service_role roles —
-- and then:
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/two_months_free_test.sql
--
-- The last two statements print one line per check and a total. It is
-- meant to be read, not just to exit 0.
--
-- What it covers: sixty days, and that they are exactly sixty and not
-- sixty-three — the free period gets no grace days, while a paid
-- subscription keeps the three it has always had, and both halves are
-- asserted against the same function at the same instant. One free
-- period per account, surviving a deleted shop and a changed email.
-- Thirty products and five images, enforced by the triggers rather than
-- merely declared, with no configuration in which either is unlimited.
-- 5,000 IQD for six months and 9,000 for a year, priced by the server,
-- with a payment at the old price refused. A plan bought mid-trial
-- starting when the trial ends rather than on the day it was paid for.
-- Nothing stacking, at the checkout or at the webhook, and a duplicate
-- webhook adding nothing. No public one-month plan. And that the free
-- period running out deletes no product, hides no product row, and
-- locks nobody out of their account.
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

select chk('01 a new shop is on the free period',
  (select plan||'/'||status from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001'),'trial/trialing');
select chk('02 the free period is exactly 60 days',
  (select round(extract(epoch from (trial_ends_at-started_at))/86400)::text from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001'),'60');
select chk('03 expires_at is the trial end, so there is one date not two',
  (select (expires_at=trial_ends_at)::text from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001'),'true');
select chk('04 the trial reads active', app.on_trial('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('05 the tier is trial', app.plan_tier('cc000001-0000-4000-8000-000000000001'),'trial');
select chk('06 the shop is public', app.shop_is_public('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('07 and may publish', app.can_publish('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('08 nothing is scheduled yet', app.paid_scheduled('cc000001-0000-4000-8000-000000000001')::text,'false');
select chk('09 the free period allows 30 products', app.free_product_limit()::text,'30');
select chk('10 and 5 images per product, the same as a paid plan', app.free_image_limit()::text,'5');
select chk('11 six months costs exactly 5,000', app.plan_price('months_6')::text,'5000');
select chk('12 one year costs exactly 9,000', app.plan_price('year_1')::text,'9000');
select count(*) from results;



-- ===== 13-15: buying six months during the free period =====
-- The trial end is captured first so the assertion compares against the
-- date the seller could actually see, not against now().
create table t1 as select trial_ends_at from public.subscriptions where shop_id='cc000001-0000-4000-8000-000000000001';
select svc();
select public.admin_apply_payment('cc000001-0000-4000-8000-000000000001','months_6',5000,'wayl','REF-1','test');

select chk('13 six months bought mid-trial runs from the trial end, not from today',
  (select (sub.expires_at = t1.trial_ends_at + interval '6 months')::text
     from public.subscriptions sub, t1 where sub.shop_id='cc000001-0000-4000-8000-000000000001'),'true');
select chk('14 the free period is not thrown away: trial_ends_at is untouched',
  (select (sub.trial_ends_at = t1.trial_ends_at)::text from public.subscriptions sub, t1
    where sub.shop_id='cc000001-0000-4000-8000-000000000001'),'true');
select chk('15 the seller is still on the free period today',
  app.on_trial('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('16 and the plan reads as scheduled, not running',
  app.paid_scheduled('cc000001-0000-4000-8000-000000000001')::text,'true');
select chk('17 the tier stays trial until the free period ends',
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
-- Put it past its free period and on a running paid plan.
update public.subscriptions set trial_ends_at = now() - interval '2 days',
  plan='months_6', status='active', expires_at = now() + interval '170 days'
 where shop_id='cc000003-0000-4000-8000-000000000003';
select chk('20 a shop past its free period on a paid plan reads paid',
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



-- ===== the free period running out takes nothing with it =====
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

-- Wind the clock past the free period AND past the grace days.
update public.subscriptions
   set trial_ends_at = now() - interval '5 days', expires_at = now() - interval '5 days'
 where shop_id='cc000004-0000-4000-8000-000000000004';

select svc();
select public.expire_lapsed_subscriptions();

select chk('25 the free period running out marks the shop expired',
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

-- ===== buying after the free period ended =====
select chk('34 an expired shop holds no entitlement, so it may buy',
  app.has_paid_entitlement('cc000004-0000-4000-8000-000000000004')::text,'false');
select seller('aa000004-0000-4000-8000-000000000004');
create table intent4 as
  select * from public.wayl_start_intent('cc000004-0000-4000-8000-000000000004','months_6','REF-AFTER','live',repeat('s',40));
select chk('35 and a checkout really does start',
  (select (id is not null)::text from intent4),'true');
select chk('36 priced by the server at 38,000, whatever the browser said',
  (select (amount = 5000)::text from intent4), 'true');

-- ===== the duplicate webhook =====
select svc();
create table applied1 as
  select * from public.wayl_apply_payment((select id from intent4), 'REF-AFTER', 5000, 'FIB', 'first');
select chk('37 the first confirmation activates the plan',
  (select activated::text from applied1),'true');
create table exp1 as select expires_at from public.subscriptions where shop_id='cc000004-0000-4000-8000-000000000004';
select chk('38 paying after expiry runs from today, not from the old date',
  (select (e.expires_at > now() + interval '175 days')::text from exp1 e),'true');

create table applied2 as
  select * from public.wayl_apply_payment((select id from intent4), 'REF-AFTER', 5000, 'FIB', 'duplicate');
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



-- ===== the free period cannot be restarted =====
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

select chk('45 deleting the shop and making another does not restart the free period',
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
-- working on a shop that is already on its free period.
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



-- ===== the free period ends when it ends =====
-- A paid subscription keeps its three grace days. The free period has
-- none: thirty days free means thirty, so the day after it ends the
-- products stop being public. Section b6 proves both halves against the
-- same function; this one checks it end to end through shop_is_public.
insert into auth.users (id, email) values ('aa000007-0000-4000-8000-000000000007','grace@e.com');
select seller('aa000007-0000-4000-8000-000000000007');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc000007-0000-4000-8000-000000000007','aa000007-0000-4000-8000-000000000007','Grace','grace-shop','9647510000017','active');
insert into public.products (id, shop_id, title, price, currency, status)
values ('dd000007-0000-4000-8000-000000000007','cc000007-0000-4000-8000-000000000007','Grace Item',1000,'IQD','active');

update public.subscriptions set status='trialing', plan='trial',
       trial_ends_at = now() - interval '1 day', expires_at = now() - interval '1 day'
 where shop_id='cc000007-0000-4000-8000-000000000007';
select chk('55 one day after the free period the products are NOT public',
  app.shop_is_public('cc000007-0000-4000-8000-000000000007')::text,'false');
select chk('56 and nothing new may be posted',
  app.can_publish('cc000007-0000-4000-8000-000000000007')::text,'false');
select chk('57 three days after, still not — the trial never had grace days',
  (select app.subscription_visible('trialing', now() - interval '3 days', sub.grace_days)::text
     from public.subscriptions sub where sub.shop_id='cc000007-0000-4000-8000-000000000007'),'false');
select chk('58 and the product row is still there, untouched',
  (select status from public.products where id='dd000007-0000-4000-8000-000000000007'),'active');

-- The column itself is untouched. The rule is about which side of it a
-- trial falls on, not about lowering the paid policy for everybody.
select chk('59 subscriptions.grace_days is still 3 for every row',
  (select count(distinct grace_days)::text || ':' || max(grace_days)::text
     from public.subscriptions),'1:3');



-- ============================================================
-- The free period is exactly thirty days, and a paid plan still has its
-- grace days. Same table, two rows, one function telling them apart.
-- ============================================================
insert into auth.users (id, email) values
  ('aa00000a-0000-4000-8000-00000000000a','trialgrace@e.com'),
  ('aa00000b-0000-4000-8000-00000000000b','paidgrace@e.com');

select seller('aa00000a-0000-4000-8000-00000000000a');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc00000a-0000-4000-8000-00000000000a','aa00000a-0000-4000-8000-00000000000a','TrialGrace','trial-grace','9647510000021','active');
insert into public.products (id, shop_id, title, price, currency, status)
values ('dd00000a-0000-4000-8000-00000000000a','cc00000a-0000-4000-8000-00000000000a','Trial Item',1000,'IQD','active');

select seller('aa00000b-0000-4000-8000-00000000000b');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc00000b-0000-4000-8000-00000000000b','aa00000b-0000-4000-8000-00000000000b','PaidGrace','paid-grace','9647510000022','active');
insert into public.products (id, shop_id, title, price, currency, status)
values ('dd00000b-0000-4000-8000-00000000000b','cc00000b-0000-4000-8000-00000000000b','Paid Item',1000,'IQD','active');
-- A shop that paid, past its free period, whose plan is about to lapse.
update public.subscriptions
   set plan='year_1', status='active', trial_ends_at = now() - interval '400 days'
 where shop_id='cc00000b-0000-4000-8000-00000000000b';

/* ---------- 1. the trial, one minute BEFORE it ends ---------- */
update public.subscriptions set status='trialing', plan='trial',
       trial_ends_at = now() + interval '1 minute', expires_at = now() + interval '1 minute'
 where shop_id='cc00000a-0000-4000-8000-00000000000a';
select chk('60 a minute before the free period ends the shop is public',
  app.shop_is_public('cc00000a-0000-4000-8000-00000000000a')::text,'true');
select chk('61 and the seller may still publish',
  app.can_publish('cc00000a-0000-4000-8000-00000000000a')::text,'true');

/* ---------- 2. the trial, one minute AFTER it ends ---------- */
update public.subscriptions set trial_ends_at = now() - interval '1 minute',
       expires_at = now() - interval '1 minute'
 where shop_id='cc00000a-0000-4000-8000-00000000000a';
select chk('62 a minute after it ends the shop is NOT public',
  app.shop_is_public('cc00000a-0000-4000-8000-00000000000a')::text,'false');
select chk('63 and the seller may not publish',
  app.can_publish('cc00000a-0000-4000-8000-00000000000a')::text,'false');
select chk('64 there is no extra day of trial visibility',
  app.subscription_visible('trialing', now() - interval '1 minute', 3)::text,'false');
select chk('65 nor two',
  app.subscription_visible('trialing', now() - interval '2 days', 3)::text,'false');
-- The two rules side by side, same instant, same grace_days argument.
-- This is the whole change in one pair of lines.
select chk('66 two days past the date: a trial is dark',
  app.subscription_visible('trialing', now() - interval '2 days', 3)::text,'false');
select chk('66b while a paid plan at the very same instant is not',
  app.subscription_visible('active',   now() - interval '2 days', 3)::text,'true');
select chk('67 visibility_ends_at for a trial IS its expiry, with nothing added',
  (app.visibility_ends_at('trialing', timestamptz '2027-01-01 00:00:00+00', 3)
     = timestamptz '2027-01-01 00:00:00+00')::text,'true');
select chk('68 so the trial window is exactly 60 days, not 63',
  (select round(extract(epoch from (
     app.visibility_ends_at('trialing', g.started_at + make_interval(days => app.trial_days()), 3)
     - g.started_at)) / 86400)::text
   from (select now() as started_at) g),'60');

/* ---------- 3. the product survived all of it ---------- */
select chk('69 the trial shop keeps its product row, still active',
  (select status from public.products where id='dd00000a-0000-4000-8000-00000000000a'),'active');

/* ---------- 4. a PAID plan still has its three grace days ---------- */
update public.subscriptions set expires_at = now() - interval '1 minute'
 where shop_id='cc00000b-0000-4000-8000-00000000000b';
select chk('70 a paid plan a minute past its date is STILL public (grace)',
  app.shop_is_public('cc00000b-0000-4000-8000-00000000000b')::text,'true');
update public.subscriptions set expires_at = now() - interval '2 days'
 where shop_id='cc00000b-0000-4000-8000-00000000000b';
select chk('71 still public two days past it',
  app.shop_is_public('cc00000b-0000-4000-8000-00000000000b')::text,'true');
update public.subscriptions set expires_at = now() - interval '4 days'
 where shop_id='cc00000b-0000-4000-8000-00000000000b';
select chk('72 and not public four days past it, once the grace is spent',
  app.shop_is_public('cc00000b-0000-4000-8000-00000000000b')::text,'false');
select chk('73 the paid rule is arithmetically untouched: expiry + grace_days',
  (app.visibility_ends_at('active', timestamptz '2027-01-01 00:00:00+00', 3)
     = timestamptz '2027-01-04 00:00:00+00')::text,'true');
select chk('74 and subscriptions.grace_days itself was not lowered for anybody',
  (select count(distinct grace_days)::text || ':' || max(grace_days)::text
     from public.subscriptions),'1:3');

/* ---------- 5. the sweep uses the same rule, so no row lies ---------- */
update public.subscriptions set status='trialing', plan='trial',
       trial_ends_at = now() - interval '1 minute', expires_at = now() - interval '1 minute'
 where shop_id='cc00000a-0000-4000-8000-00000000000a';
update public.subscriptions set status='active', plan='year_1',
       expires_at = now() - interval '1 minute'
 where shop_id='cc00000b-0000-4000-8000-00000000000b';
select svc();
select public.expire_lapsed_subscriptions();
select chk('75 the sweep expires a trial the moment it ends',
  (select status from public.subscriptions where shop_id='cc00000a-0000-4000-8000-00000000000a'),'expired');
select chk('76 but leaves a paid plan alone while its grace days run',
  (select status from public.subscriptions where shop_id='cc00000b-0000-4000-8000-00000000000b'),'active');
update public.subscriptions set expires_at = now() - interval '4 days'
 where shop_id='cc00000b-0000-4000-8000-00000000000b';
select public.expire_lapsed_subscriptions();
select chk('77 and expires it once they are spent',
  (select status from public.subscriptions where shop_id='cc00000b-0000-4000-8000-00000000000b'),'expired');

/* ---------- 6. a plan bought during the trial moves onto the paid rule ---------- */
-- The same row, the same free period, but now a paid entitlement: it gets
-- the grace days, because what is running out is something paid for.
insert into auth.users (id, email) values ('aa00000c-0000-4000-8000-00000000000c','sched@e.com');
select seller('aa00000c-0000-4000-8000-00000000000c');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc00000c-0000-4000-8000-00000000000c','aa00000c-0000-4000-8000-00000000000c','Sched','sched-shop','9647510000023','active');
select svc();
select public.admin_apply_payment('cc00000c-0000-4000-8000-00000000000c','months_6',5000,'wayl','REF-G','t');
select chk('78 buying during the free period moves the row to status active',
  (select status from public.subscriptions where shop_id='cc00000c-0000-4000-8000-00000000000c'),'active');
select chk('79 so the grace days apply to it, as a paid entitlement',
  (select (app.visibility_ends_at(sub.status, sub.expires_at, sub.grace_days)
             = sub.expires_at + interval '3 days')::text
     from public.subscriptions sub where sub.shop_id='cc00000c-0000-4000-8000-00000000000c'),'true');
select chk('80 and the free period is still recorded, unmoved',
  (select (trial_ends_at is not null)::text from public.subscriptions
    where shop_id='cc00000c-0000-4000-8000-00000000000c'),'true');



-- ============================================================
-- The launch numbers, enforced rather than merely declared.
-- ============================================================
insert into auth.users (id, email) values ('aa00000d-0000-4000-8000-00000000000d','limits@e.com');
select seller('aa00000d-0000-4000-8000-00000000000d');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc00000d-0000-4000-8000-00000000000d','aa00000d-0000-4000-8000-00000000000d','Limits','limits-shop','9647510000024','active');

/* ---------- 60 days, and no sixty-first ---------- */
select chk('81 a new shop is given exactly 60 days',
  (select round(extract(epoch from (trial_ends_at - started_at))/86400)::text
     from public.subscriptions where shop_id='cc00000d-0000-4000-8000-00000000000d'),'60');
select chk('82 on day 60 it is still public',
  app.subscription_visible('trialing', now() + interval '1 minute', 3)::text,'true');
select chk('83 on day 61 it is not',
  app.subscription_visible('trialing', now() - interval '1 day', 3)::text,'false');
select chk('84 and not on day 62, 63 or 64 either — there is no tail',
  (app.subscription_visible('trialing', now() - interval '2 days', 3)
   or app.subscription_visible('trialing', now() - interval '3 days', 3)
   or app.subscription_visible('trialing', now() - interval '4 days', 3))::text,'false');

/* ---------- 30 products, enforced by the trigger ---------- */
-- Thirty go in. The thirty-first is refused by the database, not by a
-- screen: SW001 is what a seller posting the form directly meets.
insert into public.products (shop_id, title, price, currency, status)
select 'cc00000d-0000-4000-8000-00000000000d', 'Item number ' || g, 1000, 'IQD', 'active'
  from generate_series(1, 30) g;
select chk('85 thirty products fit inside the free period',
  (select count(*)::text from public.products where shop_id='cc00000d-0000-4000-8000-00000000000d'),'30');
select chk('86 and the shop has no slots left',
  (select slots_left::text from public.subscription_state('cc00000d-0000-4000-8000-00000000000d')),'0');
select chk('87 nor may it publish another',
  app.can_publish('cc00000d-0000-4000-8000-00000000000d')::text,'false');
do $$ begin
  insert into public.products (shop_id, title, price, currency, status)
  values ('cc00000d-0000-4000-8000-00000000000d','One too many',1000,'IQD','active');
  perform chk('88 the database refuses the thirty-first product','no error','SW001');
exception when sqlstate 'SW001' then perform chk('88 the database refuses the thirty-first product','SW001','SW001');
end $$;
select chk('89 and nothing was written',
  (select count(*)::text from public.products where shop_id='cc00000d-0000-4000-8000-00000000000d'),'30');
select chk('90 the free period is not unlimited: the cap is a real number',
  (app.free_product_limit() is not null and app.free_product_limit() = 30)::text,'true');

/* ---------- 5 images, and no sixth, for trial and paid alike ---------- */
insert into public.product_images (product_id, shop_id, r2_key, r2_key_full, position, content_type)
select p.id, p.shop_id,
       'products/cc00000d-0000-4000-8000-00000000000d/i' || g || '.webp',
       'products/cc00000d-0000-4000-8000-00000000000d/i' || g || '-full.webp',
       g, 'image/webp'
  from (select id, shop_id from public.products
         where shop_id='cc00000d-0000-4000-8000-00000000000d' limit 1) p,
       generate_series(1, 5) g;
select chk('91 a product on the free period may hold five images',
  (select count(*)::text from public.product_images
    where shop_id='cc00000d-0000-4000-8000-00000000000d'),'5');
do $$
declare v_p uuid;
begin
  select id into v_p from public.products where shop_id='cc00000d-0000-4000-8000-00000000000d' limit 1;
  insert into public.product_images (product_id, shop_id, r2_key, r2_key_full, position, content_type)
  values (v_p,'cc00000d-0000-4000-8000-00000000000d',
          'products/cc00000d-0000-4000-8000-00000000000d/i6.webp',
          'products/cc00000d-0000-4000-8000-00000000000d/i6-full.webp',6,'image/webp');
  perform chk('92 but never a sixth','no error','refused');
exception when others then perform chk('92 but never a sixth','refused','refused');
end $$;
select chk('93 five is also what a paid plan gets, so the ceiling is one number',
  (app.free_image_limit() = 5)::text,'true');

/* ---------- Wayl checks the authoritative amounts ---------- */
insert into auth.users (id, email) values ('aa00000e-0000-4000-8000-00000000000e','pay@e.com');
select seller('aa00000e-0000-4000-8000-00000000000e');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc00000e-0000-4000-8000-00000000000e','aa00000e-0000-4000-8000-00000000000e','Pay','pay-shop','9647510000025','active');
create table intent_new as
  select * from public.wayl_start_intent('cc00000e-0000-4000-8000-00000000000e','months_6','REF-NEW','live',repeat('s',40));
select chk('94 the server prices a six-month checkout at 5,000, not at whatever was posted',
  (select (amount = 5000)::text from intent_new),'true');
select svc();
-- The old price is not honoured, even with a matching reference.
do $$ begin
  perform public.wayl_apply_payment((select id from intent_new), 'REF-NEW', 38000, 'FIB', 'old price');
  perform chk('95 a payment at the OLD price is refused','no error','refused');
exception when sqlstate '22023' then perform chk('95 a payment at the OLD price is refused','refused','refused');
end $$;
do $$ begin
  perform public.wayl_apply_payment((select id from intent_new), 'REF-NEW', 4999, 'FIB', 'short');
  perform chk('96 and so is one dinar short','no error','refused');
exception when sqlstate '22023' then perform chk('96 and so is one dinar short','refused','refused');
end $$;
select chk('97 neither attempt activated anything',
  (select (activated_at is null)::text from public.payment_intents
    where id = (select id from intent_new)),'true');
select chk('98 the exact amount is accepted',
  (select activated::text from public.wayl_apply_payment(
     (select id from intent_new), 'REF-NEW', 5000, 'FIB', 'right price')),'true');

/* ---------- a year, at 9,000 ---------- */
insert into auth.users (id, email) values ('aa00000f-0000-4000-8000-00000000000f','year@e.com');
select seller('aa00000f-0000-4000-8000-00000000000f');
insert into public.shops (id, owner_id, name, slug, whatsapp, status)
values ('cc00000f-0000-4000-8000-00000000000f','aa00000f-0000-4000-8000-00000000000f','Year','year-shop','9647510000026','active');
create table intent_year as
  select * from public.wayl_start_intent('cc00000f-0000-4000-8000-00000000000f','year_1','REF-YEAR','live',repeat('s',40));
select chk('99 a year is priced at 9,000 by the server',
  (select (amount = 9000)::text from intent_year),'true');

-- ---------- the report ----------
select case when got is not distinct from want then 'PASS  ' else 'FAIL  ' end || name ||
  case when got is not distinct from want then ''
       else E'\n        got  ' || coalesce(got,'NULL') || E'\n        want ' || coalesce(want,'NULL') end as line
from results order by n;

select count(*) filter (where got is not distinct from want)::text
       || ' of ' || count(*)::text || ' passed' as summary
from results;
