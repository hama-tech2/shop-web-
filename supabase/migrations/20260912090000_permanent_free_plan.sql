-- ============================================================
-- Shop Web — 0031: Free is a plan, not a countdown
--
-- The 30-day trial is gone. Every shop is on Free from the moment it
-- exists, for as long as it exists, and Free is a real plan: the shop
-- is public, the link works, and the seller may keep five products with
-- one image each. Paying lifts both limits.
--
-- What that changes, in one sentence: entitlement stops being a date
-- and becomes a count. A seller with four products may post a fifth. A
-- seller with five must delete one or pay. Nothing expires into
-- nothing.
--
-- Nothing is deleted by this migration. Shops on a trial become Free
-- and keep every product and image they have; the trial dates they were
-- given stay in trial_grants as history.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 'free' is a state a shop can be in
--
-- 'trial' and 'trialing' stay in the CHECKs. They are history now — no
-- new row will ever carry them — and dropping them would mean rewriting
-- rows that record what actually happened.
-- ------------------------------------------------------------
alter table public.subscriptions
  drop constraint subscriptions_plan_check,
  add constraint subscriptions_plan_check
    check (plan in ('none', 'free', 'trial', 'month_1', 'months_6', 'year_1')),
  drop constraint subscriptions_status_check,
  add constraint subscriptions_status_check
    check (status in ('none', 'free', 'trialing', 'active', 'expired', 'suspended'));

-- Everyone who was on a trial, or had chosen nothing, is on Free. A
-- paid subscription is untouched: status 'active' with its own date.
update public.subscriptions
   set plan = 'free', status = 'free', updated_at = now()
 where status in ('none', 'trialing', 'expired')
    or plan in ('none', 'trial');

-- ------------------------------------------------------------
-- 2. what Free allows
--
-- Both numbers are functions so the Worker can be checked against them:
-- scripts/plan-limits-test.mjs reads these definitions and fails if
-- worker/config.js disagrees.
-- ------------------------------------------------------------
create or replace function app.free_product_limit()
returns int language sql immutable as $$ select 5; $$;

comment on function app.free_product_limit() is
  'Products a Free shop may have at once. Must match FREE_PRODUCT_LIMIT in worker/config.js.';

create or replace function app.free_image_limit()
returns int language sql immutable as $$ select 1; $$;

comment on function app.free_image_limit() is
  'Images a Free product may have. Must match FREE_IMAGE_LIMIT in worker/config.js.';

-- ------------------------------------------------------------
-- 3. which side of the line a shop is on
--
-- Paid means a live paid subscription: status 'active', a plan that was
-- sold, and a date still ahead. Everything else is Free — including a
-- paid plan that has run out, which falls back rather than falling off.
-- ------------------------------------------------------------
create or replace function app.plan_tier(p_shop uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when exists (
             select 1 from public.subscriptions sub
              where sub.shop_id = p_shop
                and sub.status = 'active'
                and sub.plan in ('month_1', 'months_6', 'year_1')
                and now() < sub.expires_at
           ) then 'paid'
           else 'free'
         end;
$$;

revoke all on function app.plan_tier(uuid) from public;
grant execute on function app.plan_tier(uuid) to authenticated, service_role;

-- Suspension is the admin's stop button and outranks any plan.
create or replace function app.shop_suspended(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.subscriptions sub
     where sub.shop_id = p_shop and sub.status = 'suspended'
  );
$$;

revoke all on function app.shop_suspended(uuid) from public;
grant execute on function app.shop_suspended(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. how many more this shop may have
--
-- null on a paid plan, meaning "not this limit" — the 1000-per-shop
-- ceiling still applies and is enforced by its own trigger.
--
-- Every product counts, whatever its status: the rule the seller was
-- given is five products in the account, and a hidden one is still one
-- they can bring back without asking anybody.
-- ------------------------------------------------------------
create or replace function public.product_slots_left(p_shop uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when app.plan_tier(p_shop) = 'paid' then null
           else greatest(0, app.free_product_limit()
                            - (select count(*)::int from public.products p
                                where p.shop_id = p_shop))
         end
  from public.shops s
  where s.id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin() or app.is_service_role());
$$;

revoke all on function public.product_slots_left(uuid) from public, anon;
grant execute on function public.product_slots_left(uuid) to authenticated, service_role;

-- The trial's version of the same question. Nothing calls it now.
drop function if exists public.trial_slots_left(uuid);

-- ------------------------------------------------------------
-- 5. may this shop post right now?
--
-- No longer a date. A suspended shop may not; a paid one may; a Free
-- one may while it has a slot.
-- ------------------------------------------------------------
create or replace function app.can_publish(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not app.shop_suspended(p_shop)
     and (app.plan_tier(p_shop) = 'paid'
          or (select count(*) from public.products p where p.shop_id = p_shop)
             < app.free_product_limit());
$$;

revoke all on function app.can_publish(uuid) from public;
grant execute on function app.can_publish(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 6. the database refuses the sixth product
--
-- The Worker asks first so the seller gets a screen with a way out.
-- This is what makes that a courtesy rather than the only thing
-- standing there.
--
--   SW005  the shop is suspended
--   SW001  Free is full: delete one, or pay
-- ------------------------------------------------------------
create or replace function app.enforce_free_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_max   int := app.free_product_limit();
begin
  if app.shop_suspended(new.shop_id) then
    raise exception 'shop % is suspended', new.shop_id using errcode = 'SW005';
  end if;

  -- A paid plan: nothing to count here. products_limit_1000 still applies.
  if app.plan_tier(new.shop_id) = 'paid' then
    return new;
  end if;

  select count(*) into v_count
    from public.products p where p.shop_id = new.shop_id;

  if v_count >= v_max then
    raise exception 'free plan allows % products', v_max using errcode = 'SW001';
  end if;

  return new;
end;
$$;

drop trigger if exists products_trial_limit on public.products;
drop trigger if exists products_free_limit on public.products;
create trigger products_free_limit
  before insert on public.products
  for each row execute function app.enforce_free_product_limit();

drop function if exists app.enforce_trial_product_limit();

-- ------------------------------------------------------------
-- 7. one image on Free, five when paid
--
-- product_images carries shop_id, so the trigger can tell whose product
-- this is without a join back through products.
--
-- Images already stored are never counted against the limit: a shop
-- that drops to Free keeps the gallery it built, and re-saving it does
-- not become an error. Only a NEW image beyond the limit is refused.
-- ------------------------------------------------------------
create or replace function app.enforce_image_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_max   int;
begin
  if tg_op = 'UPDATE' and new.product_id = old.product_id then
    return new;
  end if;

  -- Re-saving a gallery upserts rows that are already stored. Those are
  -- not new images, so they must not count against the limit.
  if exists (select 1 from public.product_images i where i.r2_key = new.r2_key) then
    return new;
  end if;

  v_max := case when app.plan_tier(new.shop_id) = 'paid'
                then 5 else app.free_image_limit() end;

  select count(*) into v_count
    from public.product_images i where i.product_id = new.product_id;

  if v_count >= v_max then
    raise exception 'product % already has % image(s) (maximum)', new.product_id, v_max
      using errcode = '23514', hint = 'delete an image before adding another';
  end if;

  return new;
end;
$$;

-- The same limit where a gallery is saved in one call.
create or replace function public.save_product_images(p_product uuid, p_images jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_shop uuid;
  v_max  int;
  v_kept int;
begin
  if jsonb_typeof(p_images) <> 'array' then
    raise exception 'images must be an array' using errcode = '22023';
  end if;

  -- RLS: this only finds a product the caller is allowed to see, and the
  -- insert/delete policies re-check ownership underneath.
  select shop_id into v_shop from public.products where id = p_product;
  if v_shop is null then
    raise exception 'product not found' using errcode = '42501';
  end if;

  v_max := case when app.plan_tier(v_shop) = 'paid' then 5 else app.free_image_limit() end;

  -- What the product already has may exceed the limit: a shop that
  -- lapsed to Free keeps its gallery. Saving it again is allowed;
  -- growing it is not.
  select count(*) into v_kept from public.product_images i where i.product_id = p_product;

  if jsonb_array_length(p_images) > greatest(v_max, v_kept) then
    raise exception 'at most % image(s)', v_max using errcode = '23514';
  end if;

  -- Re-ordering swaps positions around; let the constraint settle at commit.
  set constraints public.product_images_unique_pos deferred;

  delete from public.product_images i
   where i.product_id = p_product
     and not exists (
       select 1 from jsonb_array_elements(p_images) e
       where e.value ->> 'card' = i.r2_key
     );

  insert into public.product_images (product_id, shop_id, r2_key, r2_key_full, position, content_type)
  select p_product, v_shop, e.value ->> 'card', e.value ->> 'full', e.ord, 'image/webp'
  from jsonb_array_elements(p_images) with ordinality as e(value, ord)
  on conflict (r2_key) do update
    set position    = excluded.position,
        r2_key_full = excluded.r2_key_full;
end;
$$;

revoke all on function public.save_product_images(uuid, jsonb) from public, anon;
grant execute on function public.save_product_images(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- 8. a Free shop is a public shop
--
-- This is the whole point of the plan. Without it a Free seller has a
-- link that shows nothing, and the link is the product.
--
-- Suspended stays invisible. A paid plan keeps its grace days.
-- ------------------------------------------------------------
create or replace function app.subscription_visible(
  p_status text, p_expires_at timestamptz, p_grace_days int
) returns boolean
language sql
stable
parallel safe
as $$
  select case
           when p_status in ('suspended', 'none') then false
           when p_status = 'free' then true
           else now() < p_expires_at + make_interval(days => p_grace_days)
         end;
$$;

-- ------------------------------------------------------------
-- 9. a paid plan that runs out falls back to Free
--
-- It does not expire into nothing. The nightly sweep moves it to Free,
-- where the shop stays public and keeps everything it has. What it can
-- no longer do is add a sixth product or a second image.
--
-- Deliberately NOT done here: nothing hides or deletes the products a
-- lapsed shop has above five. That decision is the owner's and is not
-- something a migration should make on its own.
-- ------------------------------------------------------------
create or replace function public.expire_lapsed_subscriptions()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if not (app.is_admin() or app.is_service_role() or auth.uid() is null) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with updated as (
    update public.subscriptions
       set plan = 'free', status = 'free', updated_at = now()
     where status in ('trialing', 'active')
       and now() >= expires_at + make_interval(days => grace_days)
    returning 1
  )
  select count(*) into v_count from updated;

  delete from public.view_dedupe where day < current_date - 7;

  return v_count;
end;
$$;

revoke all on function public.expire_lapsed_subscriptions() from public, anon;
grant execute on function public.expire_lapsed_subscriptions() to authenticated, service_role;

-- ------------------------------------------------------------
-- 10. a new shop is a Free shop
-- ------------------------------------------------------------
create or replace function app.start_trial_for_new_shop()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.subscriptions (shop_id, plan, status, started_at, expires_at, trial_used)
  values (new.id, 'free', 'free', now(), now(), false)
  on conflict (shop_id) do nothing;
  return new;
end;
$$;

comment on function app.start_trial_for_new_shop() is
  'Creates the subscription row a new shop needs, on the permanent Free plan. Named for the trial it used to start.';

-- ------------------------------------------------------------
-- 11. what the seller's screens are told
--
-- trial_available is gone: there is no trial to be available. In its
-- place, the two things a screen actually needs — which side of the
-- line this shop is on, and how many products it may still add.
-- ------------------------------------------------------------
drop function if exists public.subscription_state(uuid);

create or replace function public.subscription_state(p_shop uuid)
returns table (
  plan              text,
  status            text,
  started_at        timestamptz,
  expires_at        timestamptz,
  grace_ends_at     timestamptz,
  days_left         int,
  total_days        int,
  in_grace          boolean,
  publicly_visible  boolean,
  can_publish       boolean,
  tier              text,
  slots_left        int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    sub.plan,
    sub.status,
    sub.started_at,
    sub.expires_at,
    sub.expires_at + make_interval(days => sub.grace_days),
    greatest(0, ceil(extract(epoch from (sub.expires_at - now())) / 86400))::int,
    greatest(1, ceil(extract(epoch from (sub.expires_at - sub.started_at)) / 86400))::int,
    (now() >= sub.expires_at
      and now() < sub.expires_at + make_interval(days => sub.grace_days)),
    (s.status = 'active'
      and app.subscription_visible(sub.status, sub.expires_at, sub.grace_days)),
    app.can_publish(sub.shop_id),
    app.plan_tier(sub.shop_id),
    case
      when app.plan_tier(sub.shop_id) = 'paid' then null
      else greatest(0, app.free_product_limit()
                       - (select count(*)::int from public.products p
                           where p.shop_id = sub.shop_id))
    end
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where s.id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin());
$$;

revoke all on function public.subscription_state(uuid) from public, anon;
grant execute on function public.subscription_state(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 12. retiring the trial itself
--
-- start_trial and trial_days go. public.trial_grants stays: it records
-- which accounts were given a trial and when, which is history worth
-- keeping and costs nothing to leave in place.
-- ------------------------------------------------------------
drop function if exists public.start_trial(uuid);
drop function if exists app.trial_days();
drop function if exists app.trial_product_limit();

comment on table public.trial_grants is
  'History. Which accounts took the 30-day trial before Free became permanent. Nothing reads it now.';
