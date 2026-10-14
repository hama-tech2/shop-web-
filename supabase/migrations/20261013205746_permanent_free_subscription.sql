-- Phase 1: permanent Free, five stored products / five images.
-- Forward-only. No existing subscription, product, image, grant, payment,
-- account or shop is rewritten. Worker integration uses atomic owner RPCs below.
begin;

alter table public.subscriptions
  alter column plan set default 'free',
  alter column status set default 'free',
  alter column trial_used set default false,
  alter column expires_at drop not null,
  add column paid_starts_at timestamptz,
  add constraint subscriptions_expiry_required_except_free
    check (expires_at is not null or (plan = 'free' and status = 'free'));

comment on column public.subscriptions.paid_starts_at is
  'Start of a newly activated paid entitlement. NULL preserves legacy scheduling via trial_ends_at/started_at. Does not replace historical trial dates.';

create or replace function app.free_product_limit()
returns int language sql immutable as $$ select 5; $$;
create or replace function app.free_image_limit()
returns int language sql immutable as $$ select 5; $$;

create or replace function app.start_trial_for_new_shop()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into public.subscriptions
    (shop_id, plan, status, started_at, expires_at, trial_used)
  values (new.id, 'free', 'free', now(), null, false)
  on conflict (shop_id) do nothing;
  return new;
end;
$$;
comment on function app.start_trial_for_new_shop() is
  'Legacy trigger name retained: creates permanent Free, without writing trial_grants.';

-- Independent restrictions outrank any entitlement, including grace.
-- Missing shop/subscription metadata fails closed for writes/public reads.
create or replace function app.shop_suspended(p_shop uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select not exists (
    select 1 from public.shops s
    join public.subscriptions sub on sub.shop_id = s.id
    where s.id = p_shop and s.status = 'active' and sub.status <> 'suspended'
  );
$$;

-- Only a previously bought plan can still be scheduled. An unpaid historical
-- trial is now effectively Free; its ledger and original dates stay intact.
create or replace function app.on_trial(p_shop uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.subscriptions sub
    where sub.shop_id = p_shop
      and sub.plan in ('month_1', 'months_6', 'year_1')
      and sub.status in ('active', 'trialing')
      and now() < sub.expires_at
      and now() < coalesce(sub.paid_starts_at, sub.trial_ends_at, sub.started_at)
  );
$$;

create or replace function app.paid_scheduled(p_shop uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select app.on_trial(p_shop); $$;

create or replace function app.plan_tier(p_shop uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select case
    when app.shop_suspended(p_shop) then 'restricted'
    when exists (
      select 1 from public.subscriptions sub
      where sub.shop_id = p_shop
        and sub.plan in ('month_1', 'months_6', 'year_1')
        and sub.status in ('active', 'trialing')
        and now() >= coalesce(sub.paid_starts_at, sub.trial_ends_at, sub.started_at)
        and now() < sub.expires_at
    ) then 'paid'
    else 'free'
  end;
$$;

-- Grace protects existing public visibility, not new-product capacity.
-- After paid expiry the storage tier is Free; public paid visibility remains
-- until the exact stored grace end, independently of the nightly sweep.
create function app.paid_public_entitlement(p_shop uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select not app.shop_suspended(p_shop) and exists (
    select 1 from public.subscriptions sub
    where sub.shop_id = p_shop
      and sub.plan in ('month_1', 'months_6', 'year_1')
      and sub.status in ('active', 'trialing', 'expired')
      and now() >= coalesce(sub.paid_starts_at, sub.trial_ends_at, sub.started_at)
      and now() < sub.expires_at + make_interval(days => sub.grace_days)
  );
$$;
revoke all on function app.paid_public_entitlement(uuid) from public, anon, authenticated;
grant execute on function app.paid_public_entitlement(uuid) to service_role;

create or replace function app.subscription_visible(
  p_status text, p_expires_at timestamptz, p_grace_days int
) returns boolean language sql stable parallel safe
set search_path = public, pg_temp as $$
  select coalesce(p_status in ('none', 'free', 'trialing', 'active', 'expired'), false);
$$;
comment on function app.subscription_visible(text, timestamptz, int) is
  'Subscription no longer removes an active shop from public access. Product quota and independent restrictions are checked separately.';

create or replace function app.shop_is_public(p_shop uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select not app.shop_suspended(p_shop);
$$;

-- One whole-shop ranking: filters/search cannot each obtain a different five.
-- SECURITY DEFINER is the existing nonrecursive RLS lookup boundary. It
-- returns only a public boolean and never exposes the underlying private rows.
create or replace function app.product_is_public(p_product uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product and p.status = 'active'
      and app.shop_is_public(p.shop_id)
      and (
        app.paid_public_entitlement(p.shop_id)
        or p.id in (
          select candidate.id from public.products candidate
          where candidate.shop_id = p.shop_id and candidate.status = 'active'
          order by candidate.sort_order asc, candidate.created_at desc, candidate.id asc
          limit app.free_product_limit()
        )
      )
  );
$$;

alter policy products_select_public on public.products
  using (app.product_is_public(id));
alter policy products_select_auth on public.products
  using (app.owns_shop(shop_id) or app.product_is_public(id) or app.is_admin());
-- Image SELECT policies already call app.product_is_public(). Owner/admin
-- read and write policies, public grants and payment permissions are unchanged.

create or replace function app.can_publish(p_shop uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select not app.shop_suspended(p_shop)
    and (app.plan_tier(p_shop) = 'paid' or
      (select count(*) from public.products p where p.shop_id = p_shop)
        < app.free_product_limit());
$$;

create or replace function public.product_slots_left(p_shop uuid)
returns int language sql stable security definer
set search_path = public, pg_temp as $$
  select case
    when app.shop_suspended(p_shop) then 0
    when app.plan_tier(p_shop) = 'paid' then null
    else greatest(0, app.free_product_limit() -
      (select count(*)::int from public.products p where p.shop_id = p_shop))
  end
  from public.shops s where s.id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin() or app.is_service_role());
$$;

create or replace function app.enforce_free_product_limit()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count int;
begin
  -- Retained surplus products stay editable. Status/visibility never create
  -- storage slots and are not rewritten to satisfy the public cap.
  if tg_op = 'UPDATE' and new.shop_id = old.shop_id then return new; end if;

  -- Serialize inserts/transfers against both other inserts and subscription
  -- changes. This trigger sorts before products_limit_1000, so the retained
  -- paid ceiling is checked while holding the same lock.
  perform 1 from public.subscriptions where shop_id = new.shop_id for update;
  if not found then
    raise exception 'subscription missing' using errcode = 'P0002';
  end if;
  if app.shop_suspended(new.shop_id) then
    raise exception 'shop is restricted' using errcode = 'SW005';
  end if;
  if app.plan_tier(new.shop_id) = 'paid' then return new; end if;

  select count(*) into v_count from public.products p where p.shop_id = new.shop_id;
  if v_count >= app.free_product_limit() then
    raise exception 'free plan allows % stored products', app.free_product_limit()
      using errcode = 'SW001';
  end if;
  return new;
end;
$$;
-- Existing trigger already fires before every INSERT/UPDATE. No product
-- backfill is run. Historical demotion is retired even for privileged callers.
create or replace function app.demote_to_free_limit(p_shop uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  raise exception 'quota visibility is derived; product status must not be demoted'
    using errcode = 'SW009';
end;
$$;
revoke all on function app.demote_to_free_limit(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.expire_lapsed_subscriptions()
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not (app.is_admin() or app.is_service_role() or auth.uid() is null) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with updated as (
    update public.subscriptions sub set status = 'expired', updated_at = now()
    from public.shops s
    where s.id = sub.shop_id and s.status = 'active'
      and sub.plan in ('month_1', 'months_6', 'year_1')
      and sub.status in ('active', 'trialing')
      and now() >= sub.expires_at + make_interval(days => sub.grace_days)
    returning 1
  ) select count(*) into v_count from updated;
  delete from public.view_dedupe where day < current_date - 7;
  return v_count;
end;
$$;

-- Same authorization, payment insert and caller interface. Only the paid
-- calendar changes: historical unpaid trial dates cannot delay a NEW purchase.
-- Existing held paid plans retain the administrative extension/schedule rule.
create or replace function public.admin_apply_payment(
  p_shop uuid, p_plan text, p_amount numeric,
  p_method text default 'cash', p_reference text default null, p_note text default null
) returns payments language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_sub public.subscriptions;
  v_months int;
  v_base timestamptz;
  v_start timestamptz;
  v_held boolean;
  v_payment public.payments;
begin
  if not (app.is_admin() or app.is_service_role()) then
    raise exception 'only an admin can record payments' using errcode = '42501';
  end if;
  if p_plan not in ('month_1', 'months_6', 'year_1') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where shop_id = p_shop for update;
  if not found then
    raise exception 'shop % has no subscription row', p_shop using errcode = 'P0002';
  end if;
  if app.shop_suspended(p_shop) then
    raise exception 'shop is restricted' using errcode = 'SW005';
  end if;
  v_months := case p_plan when 'month_1' then 1 when 'months_6' then 6 else 12 end;
  v_held := v_sub.plan in ('month_1', 'months_6', 'year_1')
    and v_sub.status in ('active', 'trialing') and now() < v_sub.expires_at;
  v_base := case when v_held then v_sub.expires_at else now() end;
  v_start := case when v_held
    then coalesce(v_sub.paid_starts_at, v_sub.trial_ends_at, v_sub.started_at)
    else now() end;
  update public.subscriptions set
    plan = p_plan, status = 'active',
    paid_starts_at = v_start,
    expires_at = v_base + make_interval(months => v_months), updated_at = now()
  where shop_id = p_shop;
  insert into public.payments (
    shop_id, plan, amount, method, months_added, bonus_months,
    status, reference, note, recorded_by
  ) values (
    p_shop, p_plan, p_amount, p_method, v_months, 0,
    'confirmed', p_reference, p_note, auth.uid()
  ) returning * into v_payment;
  return v_payment;
end;
$$;

-- The return shape stays compatible; original values remain in subscriptions.
-- Effective Free has no expiry/day count. Legacy paid schedule/grace remains
-- explicit, ready for the separately approved Worker/UI phase.
create or replace function public.subscription_state(p_shop uuid)
returns table (
  plan text, status text, started_at timestamptz, expires_at timestamptz,
  grace_ends_at timestamptz, days_left int, total_days int, in_grace boolean,
  publicly_visible boolean, can_publish boolean, tier text, slots_left int,
  trial_ends_at timestamptz, trial_days_left int, on_trial boolean, paid_scheduled boolean
) language sql stable security definer set search_path = public, pg_temp as $$
  with state as (
    select sub.*, s.status as shop_status,
      app.plan_tier(sub.shop_id) as effective_tier,
      app.paid_scheduled(sub.shop_id) as scheduled,
      (sub.plan in ('month_1', 'months_6', 'year_1')
        and sub.status in ('active', 'trialing', 'expired')
        and now() >= sub.expires_at
        and now() < sub.expires_at + make_interval(days => sub.grace_days)
        and not app.shop_suspended(sub.shop_id)) as grace,
      coalesce(sub.paid_starts_at, sub.trial_ends_at, sub.started_at) as paid_start
    from public.shops s join public.subscriptions sub on sub.shop_id = s.id
    where s.id = p_shop and (s.owner_id = auth.uid() or app.is_admin())
  ) select
    case when effective_tier = 'free' and not scheduled and not grace then 'free' else state.plan end,
    case when effective_tier = 'free' and not scheduled and not grace then 'free' else state.status end,
    case when effective_tier = 'paid' or scheduled or grace then paid_start else state.started_at end,
    case when effective_tier = 'free' and not scheduled and not grace then null else state.expires_at end,
    case when effective_tier = 'paid' or scheduled or grace
      then state.expires_at + make_interval(days => state.grace_days) else null end,
    case when effective_tier = 'paid' or scheduled or grace
      then greatest(0, ceil(extract(epoch from (state.expires_at - now())) / 86400))::int else null end,
    case when effective_tier = 'paid' or scheduled or grace
      then greatest(1, ceil(extract(epoch from (state.expires_at - paid_start)) / 86400))::int else null end,
    grace, app.shop_is_public(state.shop_id), app.can_publish(state.shop_id),
    effective_tier, public.product_slots_left(state.shop_id),
    case when scheduled then paid_start else null end,
    case when scheduled then greatest(0, ceil(extract(epoch from (paid_start - now())) / 86400))::int else 0 end,
    scheduled, scheduled
  from state;
$$;

-- shop_public_profile is unchanged: suspended/banned shop status excludes its
-- header; a suspended subscription yields products_visible=false. Its existing
-- contact-header behavior is not broadened or redesigned in this phase.

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
  -- Parent lock serializes image inserts, including direct authenticated writes.
  perform 1 from public.products where id = new.product_id for update;
  if not found then raise exception 'product missing' using errcode = 'P0002'; end if;
  if tg_op = 'UPDATE' and new.product_id = old.product_id then
    return new;
  end if;

  -- Re-saving a gallery upserts rows that are already stored. Those are
  -- not new images, so they must not count against the limit.
  if exists (select 1 from public.product_images i where i.r2_key = new.r2_key and i.product_id = new.product_id) then
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
  select shop_id into v_shop from public.products where id = p_product for update;
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
-- Owner-only transaction lock. This definer performs no entitlement changes.
create function app.lock_owned_subscription(p_shop uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not (app.owns_shop(p_shop) or app.is_admin() or app.is_service_role()) then
    raise exception 'not your shop' using errcode = '42501';
  end if;
  perform 1 from public.subscriptions where shop_id = p_shop for update;
  if not found then raise exception 'subscription missing' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function app.lock_owned_subscription(uuid) from public, anon;
grant execute on function app.lock_owned_subscription(uuid) to authenticated, service_role;

-- Product and gallery commit together. All writes remain subject to owner RLS.
create function public.publish_product(p_product uuid, p_shop uuid, p_values jsonb, p_images jsonb)
returns uuid language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_existing public.products; v_gallery jsonb;
begin
  if not app.owns_shop(p_shop) then raise exception 'not your shop' using errcode = '42501'; end if;
  perform app.lock_owned_subscription(p_shop);
  if app.shop_suspended(p_shop) then raise exception 'restricted' using errcode = 'SW005'; end if;
  select * into v_existing from public.products where id = p_product;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('card',r2_key,'full',r2_key_full) order by position),'[]')
      into v_gallery from public.product_images where product_id = p_product;
    if v_existing.shop_id = p_shop
      and (to_jsonb(v_existing) @> p_values) and v_gallery = p_images then return p_product; end if;
    raise exception 'draft conflicts with saved product' using errcode = '22023';
  end if;
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) not between 1 and 5 then
    raise exception 'one to five images required' using errcode = '23514';
  end if;
  insert into public.products(id,shop_id,title,price,currency,visibility,description,status,platform_category_id,category_id)
  values(p_product,p_shop,p_values->>'title',(p_values->>'price')::numeric,
    coalesce(p_values->>'currency','IQD'),coalesce(p_values->>'visibility','everyone'),
    p_values->>'description',coalesce(p_values->>'status','active'),
    (p_values->>'platform_category_id')::uuid,(p_values->>'category_id')::uuid);
  perform public.save_product_images(p_product,p_images);
  return p_product;
end;
$$;
revoke all on function public.publish_product(uuid,uuid,jsonb,jsonb) from public, anon;
grant execute on function public.publish_product(uuid,uuid,jsonb,jsonb) to authenticated;

create function public.update_product(p_product uuid, p_values jsonb, p_images jsonb)
returns uuid language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.products where id = p_product;
  if not found then raise exception 'product missing' using errcode = 'P0002'; end if;
  if not app.owns_shop(v_shop) then raise exception 'not your shop' using errcode = '42501'; end if;
  -- Same lock order as publishing and payment activation.
  perform app.lock_owned_subscription(v_shop);
  if app.shop_suspended(v_shop) then raise exception 'restricted' using errcode = 'SW005'; end if;
  perform 1 from public.products where id = p_product for update;
  if not found then raise exception 'product missing' using errcode = 'P0002'; end if;
  update public.products set title=p_values->>'title',
    visibility=coalesce(p_values->>'visibility',visibility),
    status=coalesce(p_values->>'status',status),
    platform_category_id=(p_values->>'platform_category_id')::uuid
  where id=p_product;
  perform public.save_product_images(p_product,p_images);
  return p_product;
end;
$$;
revoke all on function public.update_product(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.update_product(uuid,jsonb,jsonb) to authenticated;

create function public.owner_products(p_shop uuid)
returns setof jsonb language plpgsql stable security invoker
set search_path = public, pg_temp as $$
begin
  if not app.owns_shop(p_shop) then raise exception 'not your shop' using errcode = '42501'; end if;
  return query select to_jsonb(p) || jsonb_build_object(
    'publicly_eligible',app.product_is_public(p.id),
    'product_images',(select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]')
      from public.product_images i where i.product_id=p.id))
    from public.products p where p.shop_id=p_shop
    order by p.sort_order asc,p.created_at desc,p.id asc;
end;
$$;
revoke all on function public.owner_products(uuid) from public, anon;
grant execute on function public.owner_products(uuid) to authenticated;

create or replace function public.wayl_start_intent(
  p_shop uuid, p_plan text, p_reference_id text, p_env text, p_secret text
)
returns table (
  id uuid, shop_id uuid, plan text, amount numeric, reference_id text,
  checkout_url text, env text, status text, reused boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_live    public.payment_intents;
  v_intent  public.payment_intents;
  v_price   numeric;
  v_linked  int;
  v_rows    int;
  v_window  interval := interval '25 minutes';
  v_usable  boolean;
begin
  if not (app.owns_shop(p_shop) or app.is_service_role()) then
    raise exception 'not your shop' using errcode = '42501';
  end if;
  if p_plan not in ('months_6', 'year_1') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;
  if p_env not in ('test', 'live') then
    raise exception 'unknown env %', p_env using errcode = '22023';
  end if;
  if p_reference_id is null or p_reference_id !~ '^[A-Za-z0-9-]{6,64}$' then
    raise exception 'bad reference' using errcode = '22023';
  end if;
  if p_secret is null or length(p_secret) not between 32 and 128 then
    raise exception 'bad secret' using errcode = '22023';
  end if;

  perform app.lock_owned_subscription(p_shop);
  if app.shop_suspended(p_shop) then
    raise exception 'shop is restricted' using errcode = 'SW005';
  end if;

  -- One paid entitlement at a time. Before the price is read and before
  -- any row is written, so a stacking attempt costs nothing and reaches
  -- nothing — a disabled button is not what stops this.
  if app.has_paid_entitlement(p_shop) then
    raise exception 'shop % already holds a paid plan', p_shop using errcode = 'SW008';
  end if;

  v_price := app.plan_price(p_plan);
  if v_price is null then
    raise exception 'no price for plan %', p_plan using errcode = '22023';
  end if;

  select * into v_live
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.plan = p_plan
     and pi.source = 'payment'
     and pi.status in ('open', 'pending')
   for update;

  if found then
    if v_live.status = 'pending' then
      raise exception 'a manual payment is already waiting' using errcode = 'SW003';
    end if;

    v_usable := v_live.created_at > now() - v_window
            and v_live.env is not distinct from p_env
            and v_live.amount = v_price;

    if v_usable and v_live.checkout_url is not null then
      return query select v_live.id, v_live.shop_id, v_live.plan, v_live.amount,
                          v_live.reference_id, v_live.checkout_url, v_live.env,
                          v_live.status, true;
      return;
    end if;

    if v_usable then
      update public.payment_intents pi
         set reference_id = p_reference_id,
             env          = p_env,
             updated_at   = now()
       where pi.id = v_live.id
      returning * into v_intent;

      insert into public.payment_intent_secrets (intent_id, webhook_secret)
           values (v_intent.id, p_secret)
      on conflict (intent_id) do update set webhook_secret = excluded.webhook_secret;

      return query select v_intent.id, v_intent.shop_id, v_intent.plan, v_intent.amount,
                          v_intent.reference_id, v_intent.checkout_url, v_intent.env,
                          v_intent.status, true;
      return;
    end if;

    update public.payment_intents pi
       set status = 'cancelled', handled_at = now()
     where pi.id = v_live.id;
  end if;

  select count(*) into v_linked
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.source = 'payment'
     and pi.checkout_url is not null
     and pi.created_at > now() - interval '10 minutes';
  if v_linked >= 6 then
    raise exception 'too many checkouts for shop %', p_shop using errcode = 'SW002';
  end if;

  select count(*) into v_rows
    from public.payment_intents pi
   where pi.shop_id = p_shop
     and pi.source = 'payment'
     and pi.created_at > now() - interval '1 hour';
  if v_rows >= 20 then
    raise exception 'too many checkouts for shop %', p_shop using errcode = 'SW002';
  end if;

  insert into public.payment_intents (shop_id, plan, amount, user_id, reference_id, env, currency)
       values (p_shop, p_plan, 0, auth.uid(), p_reference_id, p_env, 'IQD')
    returning * into v_intent;

  insert into public.payment_intent_secrets (intent_id, webhook_secret)
       values (v_intent.id, p_secret)
  on conflict (intent_id) do update set webhook_secret = excluded.webhook_secret;

  return query select v_intent.id, v_intent.shop_id, v_intent.plan, v_intent.amount,
                      v_intent.reference_id, v_intent.checkout_url, v_intent.env,
                      v_intent.status, false;
end;
$$;
create or replace function public.wayl_apply_payment(
  p_intent uuid, p_reference_id text, p_amount numeric,
  p_method text default null, p_note text default null
)
returns table (activated boolean, already_active boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent  public.payment_intents;
  v_shop uuid;
  v_price   numeric;
  v_method  text;
  v_expires timestamptz;
begin
  if not (app.is_service_role() or app.is_admin()) then
    raise exception 'service only' using errcode = '42501';
  end if;

  select pi.shop_id into v_shop from public.payment_intents pi where pi.id = p_intent;
  if not found then raise exception 'intent missing' using errcode = 'P0002'; end if;
  perform app.lock_owned_subscription(v_shop);
  select * into v_intent from public.payment_intents pi where pi.id = p_intent for update;
  if not found then
    raise exception 'intent % not found', p_intent using errcode = 'P0002';
  end if;

  if v_intent.source <> 'payment' then
    raise exception 'intent % is not a payment', p_intent using errcode = '22023';
  end if;
  if v_intent.reference_id is null or v_intent.reference_id is distinct from p_reference_id then
    raise exception 'reference does not match intent %', p_intent using errcode = '22023';
  end if;
  if v_intent.currency <> 'IQD' then
    raise exception 'intent % is not IQD', p_intent using errcode = '22023';
  end if;

  v_price := app.plan_price(v_intent.plan);
  if v_price is null or p_amount is null
     or p_amount <> v_price or v_intent.amount <> v_price then
    raise exception 'amount % is not the price of %', p_amount, v_intent.plan
      using errcode = '22023';
  end if;

  -- Already done. A webhook retry and a browser poll landing together
  -- is the normal case, and both must be able to read the answer
  -- without a second plan being granted.
  if v_intent.activated_at is not null then
    select s.expires_at into v_expires
      from public.subscriptions s where s.shop_id = v_intent.shop_id;
    return query select false, true, v_expires;
    return;
  end if;

  if v_intent.status not in ('open', 'pending') then
    raise exception 'intent % is already %', p_intent, v_intent.status using errcode = '22023';
  end if;

  -- A different intent, for a shop that already holds a paid plan.
  if app.has_paid_entitlement(v_intent.shop_id) then
    raise exception 'shop % already holds a paid plan', v_intent.shop_id
      using errcode = 'SW008';
  end if;

  v_method := case when p_method ~ '^[A-Za-z0-9 _.-]{1,32}$' then p_method else null end;

  perform public.admin_apply_payment(
    v_intent.shop_id, v_intent.plan, v_intent.amount, 'wayl',
    v_intent.reference_id, coalesce(p_note, 'wayl'));

  update public.payment_intents pi
     set status         = 'paid',
         paid_at        = coalesce(pi.paid_at, now()),
         activated_at   = now(),
         payment_method = coalesce(v_method, pi.payment_method),
         handled_at     = now()
   where pi.id = p_intent;

  select s.expires_at into v_expires
    from public.subscriptions s where s.shop_id = v_intent.shop_id;

  return query select true, false, v_expires;
end;
$$;
commit;
