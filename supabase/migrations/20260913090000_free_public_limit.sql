-- ============================================================
-- Shop Web — 0032: five public products on Free, and no data lost
--
-- 0031 made Free permanent and capped a Free shop at five products.
-- It left one case open: a paid shop with forty products that lapses.
-- Nothing was deleted, which was right, but all forty stayed on the
-- public storefront, which was not the plan a Free seller is on.
--
-- The rule this settles: a Free shop may have five products PUBLIC at
-- once. Everything above that is hidden, not destroyed — the seller
-- keeps every product, every image and every R2 key, and may swap
-- which five are up whenever they like.
--
-- Nothing here deletes a row. The only thing it writes is
-- products.status, from 'active' to 'hidden', which is the same state
-- a seller can set from the edit form and undo from the same place.
-- ============================================================

-- ------------------------------------------------------------
-- 1. which five stay up
--
-- The first five in the order the storefront already shows them:
-- sort_order ascending, then newest first, then id to break a tie.
-- That is deterministic, it needs no new column, and it means the
-- seller's own ordering decides — the five a customer saw at the top
-- this morning are the five still there this afternoon.
--
-- Returns how many were hidden, so the sweep can report it.
-- ------------------------------------------------------------
create or replace function app.demote_to_free_limit(p_shop uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hidden int;
begin
  -- A paid shop has no public cap; the 1000-per-shop ceiling is its own.
  if app.plan_tier(p_shop) = 'paid' then
    return 0;
  end if;

  with ranked as (
    select p.id,
           row_number() over (
             order by p.sort_order asc, p.created_at desc, p.id asc
           ) as rank
      from public.products p
     where p.shop_id = p_shop
       and p.status = 'active'
  ),
  demoted as (
    update public.products p
       set status = 'hidden', updated_at = now()
      from ranked r
     where p.id = r.id
       and r.rank > app.free_product_limit()
    returning 1
  )
  select count(*)::int into v_hidden from demoted;

  return v_hidden;
end;
$$;

comment on function app.demote_to_free_limit(uuid) is
  'Hides a Free shop''s active products beyond the Free limit, keeping the first five in storefront order. Deletes nothing.';

revoke all on function app.demote_to_free_limit(uuid) from public, anon;
grant execute on function app.demote_to_free_limit(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 2. and no sixth one goes back up
--
-- The seller may swap freely: hide one, show another. What they may
-- not do is have six up at once. The check runs only when a product is
-- actually becoming visible, so editing, re-ordering or hiding a
-- product on a shop that is over the cap all still work — which is
-- exactly how a lapsed seller digs themselves out.
--
--   SW005  the shop is suspended            (insert)
--   SW001  Free is full: delete one, or pay (insert)
--   SW007  five are already public          (update)
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
  -- Becoming visible, on an update. The row itself is not counted:
  -- it is not active yet.
  if tg_op = 'UPDATE' then
    if new.status <> 'active' or old.status = 'active' then
      return new;
    end if;
    if app.plan_tier(new.shop_id) = 'paid' then
      return new;
    end if;
    select count(*) into v_count
      from public.products p
     where p.shop_id = new.shop_id and p.status = 'active' and p.id <> new.id;
    if v_count >= v_max then
      raise exception 'free plan allows % public products', v_max using errcode = 'SW007';
    end if;
    return new;
  end if;

  if app.shop_suspended(new.shop_id) then
    raise exception 'shop % is suspended', new.shop_id using errcode = 'SW005';
  end if;

  -- A paid plan: nothing to count here. products_limit_1000 still applies.
  if app.plan_tier(new.shop_id) = 'paid' then
    return new;
  end if;

  -- Every product counts, hidden ones included. A seller sitting on
  -- forty from a plan that lapsed has no room for a forty-first: the
  -- way out is to delete some, or to pay.
  select count(*) into v_count
    from public.products p where p.shop_id = new.shop_id;

  if v_count >= v_max then
    raise exception 'free plan allows % products', v_max using errcode = 'SW001';
  end if;

  -- Belt and braces: a new product is born active, so it must also fit
  -- under the public cap. With the total cap above this cannot fire,
  -- and it is here so that it still holds if that ever changes.
  select count(*) into v_count
    from public.products p
   where p.shop_id = new.shop_id and p.status = 'active';

  if new.status = 'active' and v_count >= v_max then
    raise exception 'free plan allows % public products', v_max using errcode = 'SW007';
  end if;

  return new;
end;
$$;

drop trigger if exists products_free_limit on public.products;
create trigger products_free_limit
  before insert or update on public.products
  for each row execute function app.enforce_free_product_limit();

-- ------------------------------------------------------------
-- 3. the sweep hides the extras as it moves a shop to Free
--
-- Still nothing deleted, and nothing about the seller's data lost: the
-- products, the images and the R2 keys are all exactly where they were.
-- Paying again lifts the cap, and the seller puts back whichever ones
-- they want.
-- ------------------------------------------------------------
create or replace function public.expire_lapsed_subscriptions()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shops uuid[];
  v_shop  uuid;
begin
  if not (app.is_admin() or app.is_service_role() or auth.uid() is null) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with updated as (
    update public.subscriptions
       set plan = 'free', status = 'free', updated_at = now()
     where status in ('trialing', 'active')
       and now() >= expires_at + make_interval(days => grace_days)
    returning shop_id
  )
  select coalesce(array_agg(shop_id), '{}') into v_shops from updated;

  -- Now that they are Free, bring each one down to five public products.
  foreach v_shop in array v_shops loop
    perform app.demote_to_free_limit(v_shop);
  end loop;

  delete from public.view_dedupe where day < current_date - 7;

  return coalesce(array_length(v_shops, 1), 0);
end;
$$;

revoke all on function public.expire_lapsed_subscriptions() from public, anon;
grant execute on function public.expire_lapsed_subscriptions() to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. the shops that are already over it
--
-- Every shop that 0031 moved to Free, and every shop that was already
-- there, brought down to five public products once. Again: status
-- only, nothing deleted.
-- ------------------------------------------------------------
do $$
declare
  v_shop uuid;
  v_total int := 0;
begin
  for v_shop in
    select s.shop_id
      from public.subscriptions s
     where s.status = 'free'
       and (select count(*) from public.products p
             where p.shop_id = s.shop_id and p.status = 'active')
           > app.free_product_limit()
  loop
    v_total := v_total + app.demote_to_free_limit(v_shop);
  end loop;
  raise notice 'free public limit backfill: % product(s) hidden', v_total;
end;
$$;
