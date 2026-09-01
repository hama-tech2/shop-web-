-- ============================================================
-- Shop Web — 0021: Sorani search, shop search, cancelling an intent
--
--   * ku_normalize now collapses ه and ە onto one code point. They are
--     different letters (h and e), but sellers and customers type them
--     interchangeably on Arabic keyboards, so an index that keeps them
--     apart simply fails to match. Both sides are normalised the same
--     way, so precision costs less than the recall it buys.
--   * shops gain name_norm + a trigram index, so /search can offer a
--     shops tab that survives a typo.
--   * search_products ranks by full text first, then by trigram
--     similarity, so a misspelling still lands.
--   * admin_cancel_intent, the counterpart to admin_activate_intent.
-- ============================================================

-- ------------------------------------------------------------
-- ku_normalize
--
-- The generated columns and their indexes have to come down first:
-- replacing the function does not rewrite values already stored, and a
-- stale title_norm is worse than none.
-- ------------------------------------------------------------
drop index if exists public.products_title_trgm_idx;
drop index if exists public.products_search_tsv_idx;
alter table public.products drop column if exists title_norm;
alter table public.products drop column if exists search_tsv;

create or replace function app.ku_normalize(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
           translate(
             lower(coalesce(txt, '')),
             -- kaf, yeh, alef-maksura, teh-marbuta, heh-goal (ە),
             -- arabic-indic digits, extended arabic-indic digits
             U&'\0643' || U&'\064A' || U&'\0649' || U&'\0629' || U&'\06D5' ||
             U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669' ||
             U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
             U&'\06A9' || U&'\06CC' || U&'\06CC' || U&'\0647' || U&'\0647' ||
             '0123456789' ||
             '0123456789'
           ),
           -- strip tatweel, ZWNJ/ZWJ and Arabic diacritics
           '[' || U&'\0640' || U&'\200C' || U&'\200D' || U&'\064B-\0652' || U&'\0670' || ']',
           '',
           'g'
         );
$$;

comment on function app.ku_normalize(text) is
  'Normalises Sorani/Arabic-script text for search: unifies ك->ک, ي/ى->ی, ة/ە->ه, folds Arabic-Indic digits, strips tatweel/ZWNJ/diacritics.';

alter table public.products
  add column title_norm text generated always as (app.ku_normalize(title)) stored,
  add column search_tsv tsvector generated always as (
    setweight(app.ku_tsvector(title), 'A') ||
    setweight(app.ku_tsvector(coalesce(description, '')), 'B')
  ) stored;

create index products_search_tsv_idx on public.products using gin (search_tsv);
create index products_title_trgm_idx on public.products using gin (title_norm extensions.gin_trgm_ops);

-- ------------------------------------------------------------
-- shops: searchable by name, and by slug for anyone pasting a link
-- ------------------------------------------------------------
alter table public.shops
  add column if not exists name_norm text
    generated always as (app.ku_normalize(name || ' ' || slug)) stored;

create index if not exists shops_name_trgm_idx
  on public.shops using gin (name_norm extensions.gin_trgm_ops);

-- ============================================================
-- search
-- ============================================================

/**
 * Products matching a query.
 *
 * Three chances to match, cheapest first: the full-text index, then a
 * trigram similarity for a misspelling, then a plain substring for a
 * partial word the tokeniser split differently. RLS still applies —
 * this is not SECURITY DEFINER — so anon sees only active products of
 * public shops.
 */
create or replace function public.search_products(
  p_query text,
  p_shop uuid default null,
  p_platform_category uuid default null,
  p_limit int default 30,
  p_offset int default 0
)
returns setof public.products
language sql
stable
as $$
  with q as (select app.ku_normalize(p_query) as n)
  select p.*
  from public.products p, q
  where (p_shop is null or p.shop_id = p_shop)
    and (p_platform_category is null or p.platform_category_id = p_platform_category)
    and (
      q.n = ''
      or p.search_tsv @@ plainto_tsquery('simple', q.n)
      or p.title_norm like '%' || q.n || '%'
      -- word_similarity, not similarity: a one-word query against a
      -- three-word title scores far below any useful threshold on the
      -- whole string. Spelled out rather than the `<%` operator because
      -- its threshold GUC is not settable on Supabase.
      or extensions.word_similarity(q.n, p.title_norm) >= 0.35
    )
  order by
    case when q.n = '' then 0
         else ts_rank(p.search_tsv, plainto_tsquery('simple', q.n)) end desc,
    case when q.n = '' then 0
         else extensions.word_similarity(q.n, p.title_norm) end desc,
    p.created_at desc
  limit least(coalesce(p_limit, 30), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_products(text, uuid, uuid, int, int) from public;
grant execute on function public.search_products(text, uuid, uuid, int, int)
  to anon, authenticated, service_role;

/**
 * Shops matching a query.
 *
 * Returns only what the public shop page already shows, plus a live
 * product count, so the shops tab can render a card without a second
 * round trip. Not SECURITY DEFINER: RLS hides a suspended or lapsed
 * shop exactly as it does everywhere else.
 */
create or replace function public.search_shops(
  p_query text,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid, name text, slug text, city text, bio text,
  logo_key text, cover_key text, product_count int
)
language sql
stable
as $$
  with q as (select app.ku_normalize(p_query) as n)
  select
    s.id, s.name, s.slug, s.city, s.bio, s.logo_key, s.cover_key,
    (select count(*) from public.products p
      where p.shop_id = s.id and p.status = 'active')::int
  from public.shops s, q
  where (
      q.n = ''
      or s.name_norm like '%' || q.n || '%'
      or extensions.word_similarity(q.n, s.name_norm) >= 0.35
    )
  order by
    case when q.n = '' then 0 else extensions.word_similarity(q.n, s.name_norm) end desc,
    s.created_at desc
  limit least(coalesce(p_limit, 20), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_shops(text, int, int) from public;
grant execute on function public.search_shops(text, int, int) to anon, authenticated, service_role;

-- ============================================================
-- favourites: merge a signed-out visitor's hearts into their account
-- ============================================================

/**
 * Adopt a list of product ids saved before the visitor signed in.
 *
 * The INSERT policy on favorites already refuses a product that is not
 * public and a user_id that is not the caller, so a hostile id list
 * cannot plant a row — it is simply skipped. Returns how many stuck.
 */
create or replace function public.merge_favorites(p_products uuid[])
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
begin
  if auth.uid() is null or p_products is null then return 0; end if;

  with inserted as (
    insert into public.favorites (user_id, product_id)
    select auth.uid(), id
    from public.products
    where id = any (p_products[1:200])
      and app.product_is_public(id)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.merge_favorites(uuid[]) from public, anon;
grant execute on function public.merge_favorites(uuid[]) to authenticated, service_role;

-- ============================================================
-- admin: the other half of the intent queue
-- ============================================================

/** Close an intent that will never be paid. No money, no time moves. */
create or replace function public.admin_cancel_intent(p_intent uuid, p_note text default null)
returns public.payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.payment_intents;
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  update public.payment_intents
     set status = 'cancelled',
         handled_at = now(),
         handled_by = auth.uid(),
         note = coalesce(p_note, note)
   where id = p_intent and status = 'open'
  returning * into v_intent;

  if not found then
    raise exception 'intent % is not open', p_intent using errcode = '22023';
  end if;

  return v_intent;
end;
$$;

revoke all on function public.admin_cancel_intent(uuid, text) from public, anon;
grant execute on function public.admin_cancel_intent(uuid, text) to authenticated, service_role;
