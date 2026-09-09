-- ============================================================
-- Shop Web — 0022: product images, 10 -> 5
--
-- A locked product decision. The limit lived in four places: the
-- Worker config, the client, the per-row trigger, and the gallery RPC.
-- Client and server disagreeing is worse than either number, so all
-- four move together; this migration is the database half.
--
-- Nothing existing is affected: the largest gallery in the database
-- has 3 images. No image is deleted here, and none is ever deleted
-- automatically to satisfy a lowered limit — an older product that
-- somehow exceeds 5 keeps every image it has and simply cannot gain
-- another until the seller removes one.
-- ============================================================

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

  if v_count >= 5 then
    raise exception 'product % already has 5 images (maximum)', new.product_id
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
begin
  if jsonb_typeof(p_images) <> 'array' then
    raise exception 'images must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_images) > 5 then
    raise exception 'at most 5 images' using errcode = '23514';
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
revoke all on function public.save_product_images(uuid, jsonb) from public, anon;
grant execute on function public.save_product_images(uuid, jsonb) to authenticated, service_role;
