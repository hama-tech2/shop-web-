-- Run only on owner-confirmed kvwgiobnpwrjwyevadvc before a separately
-- approved release. Catalog metadata only; no account/product/payment rows.
-- Export results for comparison with the isolated replay. Does not migrate.
begin read only;
select version(),current_database(),current_user;
select version from supabase_migrations.schema_migrations order by version;
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public'
and table_name in ('subscriptions','products','product_images','payment_intents','payments','trial_grants')
order by table_name,ordinal_position;
select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace='public'::regnamespace
and conrelid in ('public.subscriptions'::regclass,'public.products'::regclass,'public.product_images'::regclass,'public.payment_intents'::regclass)
order by relation,conname;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef,p.provolatile,p.proacl,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('app','public') and
  (p.proname like 'wayl_%' or p.proname in
  ('start_trial_for_new_shop','subscription_state','subscription_visible','visibility_ends_at',
   'shop_suspended','shop_is_public','product_is_public','plan_tier','on_trial','paid_scheduled',
   'has_paid_entitlement','can_publish','product_slots_left','free_product_limit','free_image_limit',
   'enforce_free_product_limit','enforce_image_limit','save_product_images','demote_to_free_limit',
   'expire_lapsed_subscriptions','admin_apply_payment','admin_activate_intent','admin_grant_plan',
   'plan_price','plan_price_for','set_intent_price','is_admin','is_service_role','owns_shop'))
order by n.nspname,p.proname,arguments;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
and tablename in ('shops','subscriptions','products','product_images','payment_intents','payments')
order by tablename,policyname;
select tgrelid::regclass::text as relation,tgname,pg_get_triggerdef(oid) as definition
from pg_trigger where not tgisinternal and tgrelid in
('public.shops'::regclass,'public.subscriptions'::regclass,'public.products'::regclass,'public.product_images'::regclass,'public.payment_intents'::regclass)
order by relation,tgname;
commit;
