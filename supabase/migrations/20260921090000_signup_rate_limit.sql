-- ============================================================
-- A throttle on making accounts and making shops
--
-- shops.owner_id is unique, so one account can only ever own one shop.
-- That means mass shop creation is not its own problem: it requires
-- mass account creation, and /signup had nothing at all standing in
-- front of it. An address that nobody has to prove they own, a password
-- of eight characters, and a script can have a thousand public shop
-- pages in a few minutes.
--
-- So the limit goes on creation, per client address, counted here
-- rather than in the Worker — a Worker has no memory between requests,
-- and Cloudflare's own rate limiter counts per data centre, which an
-- attacker spread across regions simply multiplies.
--
-- What is stored is never an IP. The Worker hashes the address with a
-- secret before it leaves, so this table holds an opaque key that
-- identifies a caller without identifying a person.
--
-- Deliberately generous: mobile users in Erbil sit behind carrier NAT,
-- so a whole neighbourhood can share one address. Ten signups an hour
-- from one address is already far outside normal use, while a spammer
-- after a thousand accounts is stopped dead.
-- ============================================================

-- ------------------------------------------------------------
-- 1. the events
--
-- No RLS policy and no grants: only app.take_rate_token(), which is
-- SECURITY DEFINER, ever reads or writes this. A seller cannot see
-- their own count, and cannot clear it.
-- ------------------------------------------------------------
create table if not exists app.rate_events (
  id          bigint generated always as identity primary key,
  bucket      text        not null,
  key         text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists rate_events_bucket_key_time_idx
  on app.rate_events (bucket, key, created_at desc);
create index if not exists rate_events_created_at_idx
  on app.rate_events (created_at);

alter table app.rate_events enable row level security;
revoke all on table app.rate_events from public, anon, authenticated;

comment on table app.rate_events is
  'One row per throttled attempt. `key` is a salted hash of the client address, never an address. Read and written only by app.take_rate_token().';

-- ------------------------------------------------------------
-- 2. take a token, or be refused
--
-- Returns true if the attempt is allowed and has been recorded, false
-- if the caller is over either limit. Nothing is recorded on a refusal:
-- a blocked attacker cannot push their own window further out by
-- keeping on trying.
--
-- Two windows, one row. A burst limit and a daily one are questions
-- about the same attempts, so they are counted over the same rows
-- rather than kept in two buckets. Taking them as two separate tokens
-- was wrong and the tests caught it: an attempt refused by the hour had
-- already spent a token for the day, so hammering the signup form drank
-- the daily allowance without a single account being made.
--
-- Race safety is the whole point of the advisory lock. Without it, ten
-- concurrent signups all read a count of nine and all insert, and the
-- limit means nothing under exactly the conditions it exists for. The
-- lock is on the (bucket, key) pair only, so two different addresses
-- never wait on each other, and it is released when the statement's
-- transaction ends whatever happens.
-- ------------------------------------------------------------
create or replace function app.take_rate_token(
  p_bucket text, p_key text,
  p_limit int, p_window interval,
  p_limit2 int default null, p_window2 interval default null
)
returns boolean
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  v_used  int;
  v_used2 int;
  v_span  interval;
begin
  if p_bucket is null or p_key is null or btrim(p_key) = '' then
    raise exception 'bucket and key are required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_window is null then
    raise exception 'a limit and a window are required' using errcode = '22023';
  end if;
  if (p_limit2 is null) <> (p_window2 is null) then
    raise exception 'a second limit needs a second window' using errcode = '22023';
  end if;
  if p_limit2 is not null and p_limit2 < 1 then
    raise exception 'a limit below one is not a limit' using errcode = '22023';
  end if;

  -- Everything below is serialised per (bucket, key). Two callers from
  -- the same address queue; callers from different addresses do not.
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || '|' || p_key, 0));

  v_span := greatest(p_window, coalesce(p_window2, p_window));
  select count(*) filter (where e.created_at > now() - p_window),
         count(*) filter (where p_window2 is not null
                            and e.created_at > now() - p_window2)
    into v_used, v_used2
    from app.rate_events e
   where e.bucket = p_bucket
     and e.key = p_key
     and e.created_at > now() - v_span;

  if v_used >= p_limit then
    return false;
  end if;
  if p_limit2 is not null and v_used2 >= p_limit2 then
    return false;
  end if;

  insert into app.rate_events (bucket, key) values (p_bucket, p_key);

  -- Opportunistic housekeeping, roughly one call in two hundred, so the
  -- table cannot grow forever and no cron has to remember it. Two days
  -- is comfortably past the longest window anything asks for.
  if random() < 0.005 then
    delete from app.rate_events where created_at < now() - interval '2 days';
  end if;

  return true;
end;
$$;

revoke all on function app.take_rate_token(text, text, int, interval, int, interval)
  from public, anon, authenticated;
grant execute on function app.take_rate_token(text, text, int, interval, int, interval)
  to service_role;

comment on function app.take_rate_token(text, text, int, interval, int, interval) is
  'Atomically takes one token for (bucket, key) against one or two rolling windows over the same rows. True if allowed and recorded, false if over either limit; a refusal records nothing. Serialised per key by an advisory lock, so concurrent callers cannot all pass a full bucket.';

-- ------------------------------------------------------------
-- 3. the two the Worker calls
--
-- The limits live here, named, so changing one is a one-line migration
-- and nobody has to go looking through the Worker for a number.
-- ------------------------------------------------------------
create or replace function public.rate_limit_signup(p_key text)
returns boolean
language sql
security definer
set search_path = app, public, pg_temp
as $$
  select app.take_rate_token('signup', p_key, 10, interval '1 hour', 30, interval '1 day');
$$;

revoke all on function public.rate_limit_signup(text) from public, anon, authenticated;
grant execute on function public.rate_limit_signup(text) to service_role;

comment on function public.rate_limit_signup(text) is
  'True if this client address may create an account now: at most 10 an hour and 30 a day, counted over the same attempts. Key is a salted hash, never an address.';

create or replace function public.rate_limit_shop(p_key text)
returns boolean
language sql
security definer
set search_path = app, public, pg_temp
as $$
  select app.take_rate_token('shop_day', p_key, 10, interval '1 day');
$$;

revoke all on function public.rate_limit_shop(text) from public, anon, authenticated;
grant execute on function public.rate_limit_shop(text) to service_role;

comment on function public.rate_limit_shop(text) is
  'True if this client address may create a shop now: at most 10 a day. One account can only own one shop, so this is the second gate, not the first.';
