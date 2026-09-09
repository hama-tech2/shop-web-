# Shop Web

Kurdish (Sorani) social shopping web app for sellers in Erbil. A seller signs
up, posts products, and gets one public profile link they share on TikTok and
Instagram. Customers browse and order over WhatsApp.

## Stack — do not change without asking

- Vanilla HTML/CSS/JS. No React, no Next.js, no framework.
- Cloudflare Workers with static assets (not Pages). Server-rendered, multi-page.
- Supabase: Postgres + Auth only. Not Supabase Storage.
- Cloudflare R2 for every image. Store R2 keys, never full URLs.
- RTL Sorani.

## Locked decisions

- IQD everywhere. One price per product. No discount, no `old_price`, no currency column.
- Auth: email + password and Continue with Google. No phone OTP, no SMS. `enable_confirmations = false`.
- Multi-page, not an SPA. `/@slug` must be server-rendered so WhatsApp and
  Facebook show a preview image — that is the whole product.
- One shop per seller. A product's category is optional.
- App name lives in `APP_NAME` in `worker/config.js`, nowhere else.

## Rules

- Never put the service_role key in frontend code.
- Ask before adding anything not asked for.
- Only show the files created. No long explanations.
- Never touch Cloudflare projects this repo did not create.

## Hard requirement — /admin is gated server-side

No non-admin user may see or act on anything under `/admin`. The check
runs on the server, against the `admins` table, on every request — never
in the browser, never by hiding markup, never by a flag the client sends.
A non-admin gets the ordinary 404, not a redirect and not a "forbidden":
the response must not reveal that `/admin` exists at all.

Every `/admin` write goes through the database as the admin's own user,
so RLS is a second, independent check. A client-side test is never the
only thing standing between a seller and an admin action.

## Adding and removing an admin

The `admins` table is the whole of it. There is no admin UI for this on
purpose: making somebody an admin is a database action, done
deliberately, not a button somebody can be talked into pressing.

A user must have signed in at least once before they can be made an
admin — the row is keyed on `auth.users.id`, which does not exist until
their first sign-in.

Find the user first, and read the email back before you act:

```sql
select id, email, raw_app_meta_data->>'provider' as provider, created_at
from auth.users
where lower(email) = lower('someone@example.com');
```

Add:

```sql
insert into public.admins (user_id, role)
select id, 'superadmin' from auth.users
where lower(email) = lower('someone@example.com')
on conflict (user_id) do update set is_active = true;
```

`role` is `'admin'` or `'superadmin'` — the CHECK allows nothing else.

Remove — prefer deactivating, which keeps the audit trail intact:

```sql
update public.admins set is_active = false
where user_id = (select id from auth.users
                 where lower(email) = lower('someone@example.com'));
```

Delete outright only if the row was created by mistake:

```sql
delete from public.admins
where user_id = (select id from auth.users
                 where lower(email) = lower('someone@example.com'));
```

List who has it:

```sql
select u.email, a.role, a.is_active, a.created_at
from public.admins a join auth.users u on u.id = a.user_id
order by a.created_at;
```

`app.is_admin()` reads `is_active`, so deactivating takes effect on the
next request. Nothing is cached.

## Project identity guard

If a future message clearly conflicts with this project's product, repository,
architecture, design system, database, or established purpose, or appears to
belong to another project, do not implement it and do not silently adapt it.

Respond instead:

> This message appears to belong to another project. I have not changed anything. Please confirm whether you want this applied to the current project.

Only continue after the user confirms that the conflicting request really
belongs to Shop Web.

## End every session with a copyable summary

Always finish a session with a summary inside ONE markdown code block, so it
renders a copy button on mobile. No nested code fences. Keep it short, four
headings:

- what you built
- what changed
- what is broken or missing
- questions for me

Do this every time, unprompted.
