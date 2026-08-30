-- ============================================================
-- Shop Web — 0006: audit_log, reports, deleted_objects
-- ============================================================

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users (id) on delete set null,
  actor_role  text,
  is_admin    boolean not null default false,
  action      text not null check (action in ('insert', 'update', 'delete')),
  table_name  text not null,
  row_id      text,
  shop_id     uuid,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.audit_log is 'Append-only change log. Readable by admins only, written by triggers.';

-- ------------------------------------------------------------
-- reports — abuse reports from the public side.
-- Anyone may file one; only admins may read or act on them.
-- ------------------------------------------------------------
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid references public.products (id) on delete set null,
  shop_id      uuid references public.shops (id) on delete set null,
  reporter_id  uuid references auth.users (id) on delete set null,
  reason       text not null check (reason in ('fake', 'scam', 'offensive', 'stolen_photos', 'wrong_price', 'other')),
  details      text check (details is null or char_length(details) <= 2000),
  status       text not null default 'open'
                 check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  handled_by   uuid references auth.users (id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint reports_target_present check (product_id is not null or shop_id is not null)
);

comment on table public.reports is 'Public abuse reports. Insert-only for users; admins read and resolve.';

-- ------------------------------------------------------------
-- deleted_objects — the R2 delete queue.
-- Nothing in the app ever deletes from R2 directly. Deleting a row
-- that owns an image enqueues its key here; a worker drains the queue.
-- No grants and no policies: service_role only.
-- ------------------------------------------------------------
create table public.deleted_objects (
  id            bigint generated always as identity primary key,
  bucket        text not null default 'shop-web-images',
  r2_key        text not null,
  source_table  text not null,
  source_row_id text,
  shop_id       uuid,
  reason        text not null default 'row_deleted'
                  check (reason in ('row_deleted', 'row_replaced', 'shop_deleted', 'admin_purge')),
  queued_at     timestamptz not null default now(),
  processed_at  timestamptz,
  attempts      int not null default 0,
  last_error    text
);

comment on table public.deleted_objects is
  'Queue of R2 keys awaiting deletion. Drained by a Worker using R2 bindings — never delete from R2 inline.';

create index deleted_objects_pending_idx
  on public.deleted_objects (queued_at)
  where processed_at is null;

-- ------------------------------------------------------------
-- Enqueue helper + triggers
-- ------------------------------------------------------------
create or replace function app.enqueue_r2_key(
  p_key text, p_table text, p_row_id text, p_shop uuid, p_reason text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return;
  end if;
  insert into public.deleted_objects (r2_key, source_table, source_row_id, shop_id, reason)
  values (p_key, p_table, p_row_id, p_shop, p_reason);
end;
$$;

revoke all on function app.enqueue_r2_key(text, text, text, uuid, text) from public;

-- product_images: delete or key swap
create or replace function app.queue_product_image_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform app.enqueue_r2_key(old.r2_key, 'product_images', old.id::text, old.shop_id, 'row_deleted');
    return old;
  elsif tg_op = 'UPDATE' and new.r2_key is distinct from old.r2_key then
    perform app.enqueue_r2_key(old.r2_key, 'product_images', old.id::text, old.shop_id, 'row_replaced');
  end if;
  return new;
end;
$$;

create trigger product_images_queue_r2_delete
  after delete on public.product_images
  for each row execute function app.queue_product_image_delete();

create trigger product_images_queue_r2_replace
  after update of r2_key on public.product_images
  for each row execute function app.queue_product_image_delete();

-- shops: logo / cover swap or shop removal
create or replace function app.queue_shop_image_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform app.enqueue_r2_key(old.logo_key,  'shops', old.id::text, old.id, 'shop_deleted');
    perform app.enqueue_r2_key(old.cover_key, 'shops', old.id::text, old.id, 'shop_deleted');
    return old;
  end if;

  if new.logo_key is distinct from old.logo_key then
    perform app.enqueue_r2_key(old.logo_key, 'shops', old.id::text, old.id, 'row_replaced');
  end if;
  if new.cover_key is distinct from old.cover_key then
    perform app.enqueue_r2_key(old.cover_key, 'shops', old.id::text, old.id, 'row_replaced');
  end if;
  return new;
end;
$$;

create trigger shops_queue_r2_delete
  after delete on public.shops
  for each row execute function app.queue_shop_image_delete();

create trigger shops_queue_r2_replace
  after update of logo_key, cover_key on public.shops
  for each row execute function app.queue_shop_image_delete();

-- ------------------------------------------------------------
-- Audit triggers
-- ------------------------------------------------------------
create or replace function app.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_shop uuid;
  v_row  text;
begin
  v_shop := coalesce(
    nullif(v_new ->> 'shop_id', '')::uuid,
    nullif(v_old ->> 'shop_id', '')::uuid,
    case when tg_table_name = 'shops'
         then coalesce(nullif(v_new ->> 'id', ''), nullif(v_old ->> 'id', ''))::uuid end
  );
  v_row := coalesce(v_new ->> 'id', v_old ->> 'id');

  insert into public.audit_log (
    actor_id, actor_role, is_admin, action, table_name, row_id, shop_id, old_data, new_data
  ) values (
    auth.uid(), current_user, coalesce(app.is_admin(), false),
    lower(tg_op), tg_table_name, v_row, v_shop, v_old, v_new
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger shops_audit
  after insert or update or delete on public.shops
  for each row execute function app.write_audit();

create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function app.write_audit();

create trigger subscriptions_audit
  after insert or update or delete on public.subscriptions
  for each row execute function app.write_audit();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function app.write_audit();

create trigger admins_audit
  after insert or update or delete on public.admins
  for each row execute function app.write_audit();
