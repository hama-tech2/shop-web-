-- ============================================================
-- Shop Web — a product is priced in IQD or in USD.
--
-- This reverses migration 0012 (20260829192000), which dropped
-- products.currency and recorded "Always IQD" in the column comment.
-- The rule has changed: a seller in Erbil quoting a phone or a perfume
-- in dollars was writing "$" into the product title to say so, because
-- the form would not let them say it anywhere else.
--
-- What has NOT changed:
--   * One price per product. One currency per product. Still no
--     discount, no old_price, no second amount.
--   * Nothing converts. 25000 IQD and 25 USD are two prices a seller
--     typed, not one price in two units, and the database is not going
--     to pretend otherwise by holding a rate.
--   * Wayl, subscriptions and payments are untouched and remain IQD.
--     public.payments has no currency column and does not get one here:
--     what a shopper pays a shop has nothing to do with what a shop
--     pays us.
--
-- Existing rows become IQD, which is what they have always been —
-- NOT NULL DEFAULT does that in one pass with no backfill to get wrong.
-- ============================================================

alter table public.products
  add column currency text not null default 'IQD';

-- The allowed values, at the database, so a bug in the Worker cannot
-- write a third currency that every price in the app would then have to
-- know how to render. Named, so a violation says what it was.
alter table public.products
  add constraint products_currency_allowed check (currency in ('IQD', 'USD'));

comment on column public.products.price is
  'The amount the seller typed. Read it with currency — on its own it means nothing.';

comment on column public.products.currency is
  'IQD or USD, chosen per product, defaulting to IQD. Never converted: '
  'changing it leaves price exactly as it was. Unrelated to subscription '
  'payments, which are always IQD.';

comment on table public.products is
  'Products. Exactly one price and one currency — discounts / old_price are intentionally absent.';
