import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin';
import { readdirSync, readFileSync } from 'node:fs';

// In-memory PostgreSQL only. No URL, env loading, network or real accounts.
// The synthetic Auth shim does not verify Supabase JWTs or emulate PostgREST.
export async function databaseFixture({ through = null } = {}) {
  const db = new PGlite({ extensions: { pg_trgm, btree_gin } });
  try {
    await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema extensions;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, phone text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    -- Supabase bootstrap supplies extensions-schema access; plain PGlite does not.
    -- This is an explicit shim assumption, to verify separately on the host.
    grant usage on schema auth, public, extensions to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    const migrations = readdirSync(directory).filter((f) => f.endsWith('.sql')).sort();
    for (const name of migrations) {
      if (through && name > through) break;
      try { await db.exec(readFileSync(new URL(name, directory), 'utf8')); }
      catch (error) { throw new Error(`Migration ${name} failed: ${error.message}`, { cause: error }); }
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}
