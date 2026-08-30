-- ============================================================
-- Shop Web — 0018: what the account screens need
--
--   * a hard cap of 20 seller categories, enforced by trigger
--   * payment_intents: a seller can say "I want to pay" before any
--     payment processor exists. Deliberately NOT the payments table —
--     that one records money actually received and stays admin-write.
--   * subscription_state gains started_at, so the trial progress bar
--     has something to measure against
-- ============================================================

-- ---------- 20 categories per shop ----------
create or replace function app.enforce_category_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if tg_op = 'UPDATE' and new.shop_id = old.shop_id then
    return new;
  end if;

  select count(*) into v_count from public.categories where shop_id = new.shop_id;

  if v_count >= 20 then
    raise exception 'shop % already has 20 categories (maximum)', new.shop_id
      using errcode = '23514', hint = 'delete a category before adding another';
  end if;

  return new;
end;
$$;

create trigger categories_limit_20
  before insert or update of shop_id on public.categories
  for each row execute function app.enforce_category_limit();

-- ---------- payment intents ----------
create table public.payment_intents (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  plan        text not null check (plan in ('months_6', 'year_1')),
  -- snapshot of the advertised price, so a later price change does not
  -- rewrite what the seller was actually shown
  amount      numeric(12, 2) not null check (amount >= 0),
  status      text not null default 'open'
                check (status in ('open', 'contacted', 'paid', 'cancelled')),
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid
);

comment on table public.payment_intents is
  'A seller pressing "pay" before any processor exists. Not money — see payments for that.';

create index payment_intents_open_idx
  on public.payment_intents (created_at desc) where status = 'open';
create index payment_intents_shop_idx on public.payment_intents (shop_id, created_at desc);

alter table public.payment_intents enable row level security;
revoke all on table public.payment_intents from anon, authenticated;
grant all on table public.payment_intents to service_role;
grant select, insert on public.payment_intents to authenticated;

-- The seller may say they want to pay, and see what they said. They may
-- not mark it handled — that is the admin's word, not theirs.
create policy payment_intents_select_own on public.payment_intents
  for select to authenticated
  using (app.owns_shop(shop_id) or app.is_admin());

create policy payment_intents_insert_own on public.payment_intents
  for insert to authenticated
  with check (app.owns_shop(shop_id) and status = 'open');

create policy payment_intents_update_admin on public.payment_intents
  for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

grant update on public.payment_intents to authenticated;

create trigger payment_intents_audit
  after insert or update or delete on public.payment_intents
  for each row execute function app.write_audit();

-- ---------- subscription_state: add started_at ----------
drop function if exists public.subscription_state(uuid);

create or replace function public.subscription_state(p_shop uuid)
returns table (
  plan             text,
  status           text,
  started_at       timestamptz,
  expires_at       timestamptz,
  grace_ends_at    timestamptz,
  days_left        int,
  total_days       int,
  in_grace         boolean,
  publicly_visible boolean
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
      and app.subscription_visible(sub.status, sub.expires_at, sub.grace_days))
  from public.shops s
  join public.subscriptions sub on sub.shop_id = s.id
  where s.id = p_shop
    and (s.owner_id = auth.uid() or app.is_admin());
$$;

revoke all on function public.subscription_state(uuid) from public, anon;
grant execute on function public.subscription_state(uuid) to authenticated, service_role;
