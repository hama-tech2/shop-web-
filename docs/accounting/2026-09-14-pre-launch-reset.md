# Accounting record — the data before the pre-launch reset

Taken 2026-09-14 18:13 UTC, immediately before every shop, product and
seller account was deleted so Bazaro could launch from zero.

The complete machine-readable export — all 6 payments, all 31 payment
intents, all 9 webhook events, all 12 shops and their subscriptions — is
row `id = 1` of `app.accounting_archive` in the production database. That
table has no foreign key to `shops` or `auth.users`, so the reset could
not cascade it away. It contains **no** secrets: no webhook signing
secrets, no API tokens, no service-role key, no auth tokens.

```sql
select payload from app.accounting_archive where id = 1;
```

This file is the same evidence in a form that survives the database
entirely.

## The one real payment

Everything else below was Wayl's test environment and moved no money.
This one is real.

| | |
|---|---|
| reference | `BZ-MU19Y0W5-AADD31A42E` |
| amount | **1,000 IQD** |
| environment | **live** |
| method | Wallet |
| plan | months_6 |
| months granted | 6 (181 days) |
| shop | `jxjdj` |
| account | mahmoodmajed52@gmail.com |
| Wayl code | `C9BFDEFC` |
| Wayl link id | `cmu19y18001kzrm08b4by1mjs` |
| paid / activated | 2026-09-14 13:24:51 UTC |
| webhook event | received 13:24:50 UTC, status `Paid` |
| payment row id | `4b434d00-07cb-4e10-b6b7-20107241b5ed` |

It was charged at 1,000 IQD because the live six-month price was
temporarily lowered for exactly this transaction, then restored to
38,000 the same day.

## Every payment ever recorded

| # | date (UTC) | shop | account | plan | amount | months | env | method | reference |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-13 17:15:31 | jjjj | manazonr57@gmail.com | year_1 | 72,000 | 12 | test | Wallet | `BZ-MTZZWVUK-8B4B196919` |
| 2 | 2026-09-13 18:20:38 | kkk | w70612319@gmail.com | months_6 | 38,000 | 6 | test | Wallet | `BZ-MU04Z8F1-7A73DEA9B0` |
| 3 | 2026-09-13 22:48:49 | jdjd | charmy759@gmail.com | year_1 | 72,000 | 12 | test | Bank | `BZ-MU0EO4MR-E75B51AD9C` |
| 4 | 2026-09-14 10:38:26 | kkk | w70612319@gmail.com | months_6 | 1,000 | 6 | test | Wallet | `BZ-MU14000K-317ADDE2CC` |
| 5 | 2026-09-14 11:23:58 | bbhj | ic.shawbo@gmail.com | months_6 | 1,000 | 6 | test | Wallet | `BZ-MU15LP2O-98307896A2` |
| 6 | 2026-09-14 13:24:51 | jxjdj | mahmoodmajed52@gmail.com | months_6 | **1,000** | 6 | **live** | Wallet | `BZ-MU19Y0W5-AADD31A42E` |

Real money taken, all time: **1,000 IQD**, once, row 6.
Rows 1–5 are Wayl test-environment payments: no money moved.

## Totals at the moment of the export

| | |
|---|---|
| payments | 6 |
| payment intents | 31 (5 paid, 1 test + 4 live open, rest cancelled) |
| webhook events | 9 |
| shops | 12 |
| products | 13 (17 images) |
| auth users | 13 |
| subscriptions | 12 |
| audit_log rows | 8,315 — untouched by the reset, no FK to shops or users |

## What was deliberately not exported

Webhook signing secrets (`payment_intent_secrets`), the Wayl API token,
the Supabase service-role key, auth tokens and session records. None of
them are accounting evidence and all of them are credentials.
