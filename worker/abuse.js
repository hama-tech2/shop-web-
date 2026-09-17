/**
 * Small, fail-closed abuse controls shared by the authenticated upload routes.
 *
 * The counter lives in Postgres through the existing service-only rate-limit
 * machinery. A Worker isolate is intentionally not used as a counter: it has
 * no durable or global memory, so it would be bypassed by concurrency and by
 * requests landing on another isolate.
 */

export function bodyTooLarge(request, maxBytes) {
  const raw = request.headers.get('content-length');
  if (!raw) return false;
  const bytes = Number(raw);
  return Number.isFinite(bytes) && bytes > maxBytes;
}

export async function uploadRateAllows(env, shopId, rateLimitAllows) {
  if (!shopId || typeof rateLimitAllows !== 'function') return false;
  return rateLimitAllows(env, 'rate_limit_upload', String(shopId));
}

export const uploadLimited = () => Response.json(
  { error: 'rate_limit' },
  { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } },
);
