-- ============================================================
-- Shop Web — 0001 init: extensions, private schema, base helpers
-- ============================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gin with schema extensions;

-- Private schema. NOT exposed to PostgREST, so nothing in here is
-- reachable from the browser. Internal security helpers live here.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Sorani (Kurdish) text normalisation.
-- Sellers type the same word with Arabic or Persian code points
-- (ك/ک, ي/ی, ة/ە) and with zero-width non-joiners. Normalising both
-- the stored text and the query makes search actually match.
-- IMMUTABLE so it can back a generated column and an index.
-- ------------------------------------------------------------
create or replace function app.ku_normalize(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
           translate(
             lower(coalesce(txt, '')),
             -- kaf, yeh, alef-maksura, teh-marbuta, arabic-indic digits
             U&'\0643' || U&'\064A' || U&'\0649' || U&'\0629' ||
             U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669' ||
             U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
             U&'\06A9' || U&'\06CC' || U&'\06CC' || U&'\06D5' ||
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
  'Normalises Sorani/Arabic-script text for search: unifies ك->ک, ي/ى->ی, ة->ە, folds Arabic-Indic digits, strips tatweel/ZWNJ/diacritics.';

-- Kurdish has no Postgres text-search configuration, so we index with
-- the 'simple' dictionary over normalised text and pair it with trigrams.
create or replace function app.ku_tsvector(txt text)
returns tsvector
language sql
immutable
parallel safe
as $$
  select to_tsvector('simple', app.ku_normalize(txt));
$$;
