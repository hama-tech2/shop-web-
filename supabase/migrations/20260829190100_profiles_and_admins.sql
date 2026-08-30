-- ============================================================
-- Shop Web — 0002: profiles, admins
-- ============================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  locale      text not null default 'ckb' check (locale in ('ckb', 'en', 'ar')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_len check (full_name is null or char_length(full_name) <= 120),
  constraint profiles_phone_len     check (phone is null or char_length(phone) <= 32)
);

comment on table public.profiles is 'One row per auth user. Created automatically on sign-up.';

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------
-- admins — the ONLY source of admin authority.
-- No user-facing INSERT/UPDATE/DELETE policy is ever created for this
-- table (see the RLS migration). Rows are added out-of-band with the
-- service_role key or from the Supabase SQL editor.
-- ------------------------------------------------------------
create table public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'admin' check (role in ('admin', 'superadmin')),
  is_active   boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table public.admins is 'Admin allow-list. Has no user write policy by design; service_role only.';

-- ------------------------------------------------------------
-- Auto-create a profile row for every new auth user.
-- ------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', new.phone, '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ------------------------------------------------------------
-- Security helpers that depend on admins.
-- SECURITY DEFINER so RLS policies can call them without recursing
-- back into the policies of the tables they read.
-- ------------------------------------------------------------
create or replace function app.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins a
    where a.user_id = uid and a.is_active
  );
$$;

revoke all on function app.is_admin(uuid) from public;
grant execute on function app.is_admin(uuid) to anon, authenticated, service_role;
