/**
 * The nightly sweep.
 *
 * Three jobs, in order:
 *   1. drain `deleted_objects` — nothing ever deletes from R2 inline,
 *      triggers queue the key and this is what actually removes it.
 *   2. delete orphaned draft uploads: /app/new mints a product id
 *      before the row exists, so an abandoned form leaves objects under
 *      a product id that never appeared. Older than 24 hours only.
 *   3. expire subscriptions whose grace period has run out.
 *
 * This is the ONLY file that touches the service_role key. It runs on
 * the `scheduled` handler, never on a request, and the key is a Worker
 * secret — it is never sent to a browser and never appears in a page.
 */

const BATCH = 200;          // deletions per run
const LIST_PAGES = 10;      // R2 pages to sweep per run
const DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

function svc(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

async function rest(env, path, { method = 'GET', body, search, prefer } = {}) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${path}`);
  if (search) for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);

  const headers = svc(env);
  if (prefer) headers.prefer = prefer;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/* ============================================================
   1. drain the R2 delete queue
   ============================================================ */

export async function drainDeletions(env) {
  const rows = await rest(env, 'deleted_objects', {
    search: {
      select: 'id,r2_key,attempts',
      processed_at: 'is.null',
      attempts: 'lt.5',
      order: 'queued_at.asc',
      limit: String(BATCH),
    },
  });

  let deleted = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    try {
      // R2 delete is idempotent: a key already gone is still a success,
      // which is what makes a retried row safe.
      await env.IMAGES.delete(row.r2_key);
      await rest(env, 'deleted_objects', {
        method: 'PATCH',
        search: { id: `eq.${row.id}` },
        body: { processed_at: new Date().toISOString(), last_error: null },
      });
      deleted += 1;
    } catch (err) {
      failed += 1;
      await rest(env, 'deleted_objects', {
        method: 'PATCH',
        search: { id: `eq.${row.id}` },
        body: { attempts: (row.attempts ?? 0) + 1, last_error: String(err.message).slice(0, 500) },
      }).catch(() => {});
    }
  }

  return { deleted, failed, queued: rows?.length ?? 0 };
}

/* ============================================================
   2. orphaned draft uploads
   ============================================================ */

/** products/<shop_id>/<product_id>/<file> */
const productIdFromKey = (key) => {
  const parts = key.split('/');
  return parts.length >= 4 && parts[0] === 'products' ? parts[2] : null;
};

export async function cleanOrphanDrafts(env) {
  const cutoff = Date.now() - DRAFT_AGE_MS;
  const candidates = new Map();      // product id -> [keys]
  let cursor;

  for (let page = 0; page < LIST_PAGES; page += 1) {
    const listing = await env.IMAGES.list({ prefix: 'products/', limit: 1000, cursor });

    for (const object of listing.objects) {
      // Only objects that have had their whole grace window. A form
      // still open in a tab must not have its photos pulled away.
      if (object.uploaded && object.uploaded.getTime() > cutoff) continue;
      const id = productIdFromKey(object.key);
      if (!id) continue;
      if (!candidates.has(id)) candidates.set(id, []);
      candidates.get(id).push(object.key);
    }

    if (!listing.truncated) break;
    cursor = listing.cursor;
  }

  if (!candidates.size) return { checked: 0, deleted: 0 };

  // Which of those ids are real products? Everything else is a draft
  // that was never saved.
  const ids = [...candidates.keys()];
  const live = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const rows = await rest(env, 'products', {
      search: { select: 'id', id: `in.(${slice.join(',')})` },
    });
    for (const row of rows ?? []) live.add(row.id);
  }

  let deleted = 0;
  for (const [id, keys] of candidates) {
    if (live.has(id)) continue;
    for (const key of keys) {
      await env.IMAGES.delete(key);
      deleted += 1;
    }
  }

  return { checked: candidates.size, deleted };
}

/* ============================================================
   3. lapsed subscriptions
   ============================================================ */

export async function expireLapsed(env) {
  // The service key carries no JWT, which is the arm of the function's
  // guard that lets the cron in. A browser has no EXECUTE grant at all.
  const expired = await rest(env, 'rpc/expire_lapsed_subscriptions', {
    method: 'POST', body: {},
  });
  return { expired: Number(expired) || 0 };
}

/* ============================================================
   the handler
   ============================================================ */

export async function scheduled(event, env, ctx) {
  const run = async () => {
    const out = {};
    for (const [name, job] of [
      ['deletions', drainDeletions],
      ['drafts', cleanOrphanDrafts],
      ['subscriptions', expireLapsed],
    ]) {
      // One failing job must not stop the other two.
      try {
        out[name] = await job(env);
      } catch (err) {
        out[name] = { error: String(err.message) };
      }
    }
    console.log('cron', event.cron, JSON.stringify(out));
  };

  ctx.waitUntil(run());
}
