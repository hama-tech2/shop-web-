-- ============================================================
-- Shop Web — 0011: close the gaps the Supabase security linter found
--   * pin search_path on the remaining helper functions
--   * take EXECUTE away from anon on everything admin-facing
--     (Supabase's default privileges hand it out automatically)
-- ============================================================

alter function app.touch_updated_at()        set search_path = public, pg_temp;
alter function app.ku_normalize(text)        set search_path = public, pg_temp;
alter function app.ku_tsvector(text)         set search_path = public, pg_temp;
alter function app.subscription_visible(text, timestamptz, int)
                                             set search_path = public, pg_temp;

revoke execute on function public.admin_apply_payment(uuid, text, numeric, text, text, text, text) from anon;
revoke execute on function public.expire_lapsed_subscriptions() from anon;
revoke execute on function public.subscription_state(uuid) from anon;

-- record_view() and search_products() stay callable by anon on purpose:
-- record_view ignores anything the public cannot already see, and
-- search_products is SECURITY INVOKER so RLS still filters its rows.
