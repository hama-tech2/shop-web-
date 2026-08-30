-- ============================================================
-- Shop Web — 0015: what the add-product screen needs
--
--   * description becomes optional (only image, title and price are
--     required now)
--   * every image is stored twice: a card variant and a full variant,
--     so both keys must be tracked and both must reach the R2 delete
--     queue when the row goes away
--   * the position unique constraint becomes DEFERRABLE so a whole
--     gallery can be re-ordered in one statement
--   * the 10-image trigger stops counting a key that is already stored,
--     otherwise re-saving an unchanged gallery of 10 would be rejected
-- ============================================================

-- ---------- description is optional ----------
alter table public.products alter column description drop not null;
alter table public.products drop constraint products_desc_len;
alter table public.products
  add constraint products_desc_len
  check (description is null or char_length(description) <= 5000);

comment on column public.products.description is
  'Optional. Only image, title and price are required of a seller.';

-- ---------- the second variant ----------
alter table public.product_images add column r2_key_full text unique;

alter table public.product_images
  add constraint product_images_full_key_prefix check (
    r2_key_full is null
    or (r2_key_full like 'products/' || shop_id::text || '/%'
        and r2_key_full not like '%..%')
  );

comment on column public.product_images.r2_key is
  'Card variant, 800x1000 WebP. products/<shop_id>/<product_id>/<name>.';
comment on column public.product_images.r2_key_full is
  'Full variant, 1200x1500 WebP. Same prefix rules as r2_key.';

-- ---------- deferrable positions ----------
alter table public.product_images drop constraint product_images_unique_pos;
alter table public.product_images
  add constraint product_images_unique_pos
  unique (product_id, position) deferrable initially immediate;

-- ---------- the limit trigger must ignore keys it already holds ----------
create or replace function app.enforce_image_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if tg_op = 'UPDATE' and new.product_id = old.product_id then
    return new;
  end if;

  -- Re-saving a gallery upserts rows that are already stored. Those are
  -- not new images, so they must not count against the limit.
  if exists (select 1 from public.product_images i where i.r2_key = new.r2_key) then
    return new;
  end if;

  select count(*) into v_count
  from public.product_images
  where product_id = new.product_id;

  if v_count >= 10 then
    raise exception 'product % already has 10 images (maximum)', new.product_id
      using errcode = '23514', hint = 'delete an image before adding another';
  end if;

  return new;
end;
$$;

-- ---------- both variants go to the delete queue ----------
create or replace function app.queue_product_image_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform app.enqueue_r2_key(old.r2_key, 'product_images', old.id::text, old.shop_id, 'row_deleted');
    perform app.enqueue_r2_key(old.r2_key_full, 'product_images', old.id::text, old.shop_id, 'row_deleted');
    return old;
  end if;

  if new.r2_key is distinct from old.r2_key then
    perform app.enqueue_r2_key(old.r2_key, 'product_images', old.id::text, old.shop_id, 'row_replaced');
  end if;
  if new.r2_key_full is distinct from old.r2_key_full then
    perform app.enqueue_r2_key(old.r2_key_full, 'product_images', old.id::text, old.shop_id, 'row_replaced');
  end if;
  return new;
end;
$$;

drop trigger if exists product_images_queue_r2_replace on public.product_images;
create trigger product_images_queue_r2_replace
  after update of r2_key, r2_key_full on public.product_images
  for each row execute function app.queue_product_image_delete();

-- ============================================================
-- Save a whole gallery in one call.
--
-- SECURITY INVOKER on purpose: RLS is what stops a seller touching
-- somebody else's product, and it already does that correctly.
-- ============================================================
create or replace function public.save_product_images(p_product uuid, p_images jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_shop uuid;
begin
  if jsonb_typeof(p_images) <> 'array' then
    raise exception 'images must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_images) > 10 then
    raise exception 'at most 10 images' using errcode = '23514';
  end if;

  -- RLS: this only finds a product the caller is allowed to see, and the
  -- insert/delete policies re-check ownership underneath.
  select shop_id into v_shop from public.products where id = p_product;
  if v_shop is null then
    raise exception 'product not found' using errcode = '42501';
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
