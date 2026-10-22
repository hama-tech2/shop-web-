-- Growth decision: permanent Free increases from five to thirty stored products.
-- All write triggers, atomic publishing RPCs, slots and public RLS selection
-- already call this helper. Preserve their locking, permissions and ordering.
-- No rows, images, paid dates/grace, histories or payment functions are changed.
begin;

do $$
begin
  if to_regprocedure('app.free_product_limit()') is null
    or to_regprocedure('app.free_image_limit()') is null
    or to_regprocedure('app.paid_public_entitlement(uuid)') is null then
    raise exception 'Permanent Free predecessor migration is required';
  end if;
  if app.free_product_limit() not in (5, 30) or app.free_image_limit() <> 5 then
    raise exception 'Unexpected Free quota schema; review compatibility before release';
  end if;
end;
$$;

create or replace function app.free_product_limit()
returns int language sql immutable as $$ select 30; $$;

comment on function app.free_product_limit() is
  'Permanent Free: thirty stored products, including hidden/archived. Public fallback selects at most thirty eligible active products without rewriting seller preferences.';

commit;
