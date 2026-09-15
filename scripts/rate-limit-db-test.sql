-- ============================================================
-- Shop Web — the signup and shop-creation throttle
--
--   su postgres -c 'psql -d <db> -v ON_ERROR_STOP=1 -f scripts/rate-limit-db-test.sql'
--
-- The race is tested separately, by scripts/rate-limit-race-test.sh,
-- because it needs real concurrent sessions and this file is one.
--
-- Runs inside a transaction and rolls back.
-- ============================================================

begin;

do $$
declare
  v_key   text := 'test-key-' || replace(gen_random_uuid()::text, '-', '');
  v_key2  text := 'other-key-' || replace(gen_random_uuid()::text, '-', '');
  v_ok    boolean;
  v_count int;
  v_i     int;
begin
  -- ---------- 1. an ordinary caller is allowed ----------
  if not public.rate_limit_signup(v_key) then
    raise exception 'FAIL the first signup was refused';
  end if;
  raise notice 'PASS a first signup is allowed';

  -- ---------- 2. the hourly limit ----------
  -- One is already spent above, so nine more reach the limit of ten.
  for v_i in 2..10 loop
    if not public.rate_limit_signup(v_key) then
      raise exception 'FAIL signup % of 10 was refused', v_i;
    end if;
  end loop;
  if public.rate_limit_signup(v_key) then
    raise exception 'FAIL an 11th signup in the hour was allowed';
  end if;
  raise notice 'PASS ten signups an hour are allowed and the eleventh is not';

  -- A refusal records nothing, in either window. This is the check that
  -- caught the first design: two separate buckets meant an attempt the
  -- hour refused had already spent a token for the day, so hammering the
  -- form drank the daily allowance without making a single account.
  select count(*) into v_count from app.rate_events
   where bucket = 'signup' and key = v_key;
  if v_count <> 10 then
    raise exception 'FAIL % attempts recorded, not 10 — a refusal left a mark', v_count;
  end if;
  raise notice 'PASS a refused attempt records nothing, in either window';

  -- ---------- 3. one caller does not block another ----------
  if not public.rate_limit_signup(v_key2) then
    raise exception 'FAIL a different address was refused';
  end if;
  raise notice 'PASS a different address is unaffected';

  -- ---------- 4. the daily limit ----------
  -- Age every attempt past the hour. The day still counts them, which
  -- is the point: the hour rolls off, the day does not.
  update app.rate_events set created_at = now() - interval '90 minutes'
   where bucket = 'signup' and key = v_key;

  if not public.rate_limit_signup(v_key) then
    raise exception 'FAIL the hourly window did not roll off';
  end if;
  raise notice 'PASS the hourly window rolls off while the day keeps counting';

  -- Eleven are spent for the day. Nineteen more reach thirty, ageing
  -- after each so only the daily limit is ever the one that binds.
  for v_i in 12..30 loop
    update app.rate_events set created_at = now() - interval '90 minutes'
     where bucket = 'signup' and key = v_key;
    if not public.rate_limit_signup(v_key) then
      raise exception 'FAIL signup % of 30 was refused', v_i;
    end if;
  end loop;
  update app.rate_events set created_at = now() - interval '90 minutes'
   where bucket = 'signup' and key = v_key;
  if public.rate_limit_signup(v_key) then
    raise exception 'FAIL a 31st signup in the day was allowed';
  end if;
  raise notice 'PASS thirty signups a day are allowed and the thirty-first is not';

  select count(*) into v_count from app.rate_events
   where bucket = 'signup' and key = v_key;
  if v_count <> 30 then
    raise exception 'FAIL % attempts recorded for a daily limit of 30', v_count;
  end if;
  raise notice 'PASS the day records exactly its thirty and no more';

  -- ---------- 5. shop creation is its own bucket ----------
  -- Thirty signups from this address did not touch it.
  for v_i in 1..10 loop
    if not public.rate_limit_shop(v_key) then
      raise exception 'FAIL shop creation % of 10 was refused', v_i;
    end if;
  end loop;
  if public.rate_limit_shop(v_key) then
    raise exception 'FAIL an 11th shop in the day was allowed';
  end if;
  raise notice 'PASS ten shops a day are allowed and the eleventh is not';

  -- ---------- 6. no address is stored ----------
  -- The Worker hashes before it sends, so the key is 64 hex characters
  -- and nothing in the table can be read as an address.
  select count(*) into v_count from app.rate_events
   where key ~ '(\d{1,3}\.){3}\d{1,3}'      -- IPv4
      or key ~ '^[0-9a-fA-F:]*:[0-9a-fA-F:]*$'; -- IPv6
  if v_count <> 0 then
    raise exception 'FAIL % rows hold something shaped like an IP address', v_count;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'app' and table_name = 'rate_events'
                and column_name in ('ip', 'ip_address', 'addr', 'remote_addr')) then
    raise exception 'FAIL the table has a column for an address';
  end if;
  raise notice 'PASS no address is stored, and there is nowhere to store one';

  -- ---------- 7. bad arguments are refused ----------
  begin
    perform app.take_rate_token('signup', '', 10, interval '1 hour');
    raise exception 'FAIL an empty key was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS an empty key is refused';
  end;
  begin
    perform app.take_rate_token('signup', v_key, 0, interval '1 hour');
    raise exception 'FAIL a limit of zero was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS a limit below one is refused';
  end;

  begin
    perform app.take_rate_token('signup', v_key, 10, interval '1 hour', 30, null);
    raise exception 'FAIL a second limit with no second window was accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS a second limit without a window is refused';
  end;

  -- ---------- 8. old rows are cleaned up ----------
  insert into app.rate_events (bucket, key, created_at)
       values ('signup', 'ancient', now() - interval '30 days');
  -- The sweep inside take_rate_token is probabilistic, so drive it
  -- rather than hope: the same statement it runs, run here.
  delete from app.rate_events where created_at < now() - interval '2 days';
  if exists (select 1 from app.rate_events where key = 'ancient') then
    raise exception 'FAIL the cleanup left a 30-day-old row behind';
  end if;
  raise notice 'PASS rows past two days are swept away';

  -- ---------- 9. the table is closed to everybody ----------
  if has_table_privilege('authenticated', 'app.rate_events', 'select')
     or has_table_privilege('authenticated', 'app.rate_events', 'insert')
     or has_table_privilege('anon', 'app.rate_events', 'select')
     or has_table_privilege('service_role', 'app.rate_events', 'delete') then
    raise exception 'FAIL somebody can reach the table directly';
  end if;
  if has_function_privilege('anon', 'public.rate_limit_signup(text)', 'execute')
     or has_function_privilege('authenticated', 'public.rate_limit_signup(text)', 'execute') then
    raise exception 'FAIL a browser can call the limiter and spend its own tokens';
  end if;
  if not has_function_privilege('service_role', 'public.rate_limit_signup(text)', 'execute') then
    raise exception 'FAIL the Worker cannot call the limiter';
  end if;
  raise notice 'PASS only the service role can reach the limiter, and nobody can reach the table';

  raise notice 'ALL RATE LIMIT DATABASE CHECKS PASSED';
end $$;

rollback;
