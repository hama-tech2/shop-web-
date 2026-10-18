import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon';
import { SITE_ORIGIN, MAX_UPLOAD_BYTES } from './config.js';
import { getProduct } from './supabase.js';
import { imageSize } from './image-size.js';

export const PREVIEW_SIZE = 600;
export const PREVIEW_MAX_BYTES = 200 * 1024;
const VERSION = '1'; // Bump if encoding/layout changes, so the image URL also changes.
const missing = () => new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });

export async function productPreview(product) {
  const key = product?.images?.[0]?.full || product?.images?.[0]?.card;
  if (!key || !product?.id) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${VERSION}\n${key}`));
  const version = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return { key, version, url: `${SITE_ORIGIN}/preview/products/${product.id}/${version}.jpg` };
}

/** A small JPEG of the seller's actual full photo; contain, never stretch/crop. */
export function previewJpeg(bytes) {
  const size = imageSize(bytes);
  if (!size || bytes.length > MAX_UPLOAD_BYTES || !size.width || !size.height ||
      size.width > 4096 || size.height > 4096 || size.width * size.height > 4000000)
    throw new Error('unsupported preview source');
  let input, scaled, output;
  try {
    input = PhotonImage.new_from_byteslice(bytes);
    if (input.get_width() !== size.width || input.get_height() !== size.height)
      throw new Error('preview dimensions mismatch');
    const scale = Math.min(1, PREVIEW_SIZE / size.width, PREVIEW_SIZE / size.height);
    const width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale));
    scaled = resize(input, width, height, SamplingFilter.Triangle);
    const pixels = scaled.get_raw_pixels(), canvas = new Uint8Array(PREVIEW_SIZE * PREVIEW_SIZE * 4).fill(255);
    const left = Math.floor((PREVIEW_SIZE - width) / 2), top = Math.floor((PREVIEW_SIZE - height) / 2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4, target = ((top + y) * PREVIEW_SIZE + left + x) * 4;
      const alpha = pixels[source + 3] / 255;
      for (let c = 0; c < 3; c++) canvas[target + c] = Math.round(pixels[source + c] * alpha + 255 * (1 - alpha));
    }
    output = new PhotonImage(canvas, PREVIEW_SIZE, PREVIEW_SIZE);
    for (const quality of [78, 60, 40, 20]) {
      const jpeg = output.get_bytes_jpeg(quality);
      if (jpeg.length <= PREVIEW_MAX_BYTES) return jpeg;
    }
    throw new Error('preview too large');
  } finally { output?.free(); scaled?.free(); input?.free(); }
}

/** Public, but eligible-product RLS and the current cover are checked even on cache hits. */
export async function productPreviewGet(request, env, id, version, ctx, cache = globalThis.caches?.default) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {
    status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
  });
  const product = await getProduct(env, id); // publishable key only, no privileged reads
  const preview = await productPreview(product);
  if (!preview || preview.version !== version || !/^products\//.test(preview.key) || preview.key.includes('..')) return missing();
  const etag = `"product-preview-${VERSION}-${version}"`;
  const headers = new Headers({ 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=0, must-revalidate', etag });
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const cacheKey = new Request(preview.url);
  let cached;
  try { cached = await cache?.match(cacheKey); } catch { /* Cache failures must not break previews. */ }
  if (cached) {
    headers.set('content-length', cached.headers.get('content-length'));
    return new Response(request.method === 'HEAD' ? null : cached.body, { headers });
  }
  const object = await env.IMAGES.get(preview.key);
  if (!object) return missing(); // No seed/brand/AI substitute for a missing product photo.
  if (object.size > MAX_UPLOAD_BYTES) { await object.body.cancel(); return missing(); }
  let jpeg;
  try { jpeg = previewJpeg(new Uint8Array(await object.arrayBuffer())); }
  catch { return missing(); }
  headers.set('content-length', String(jpeg.length));
  if (cache && ctx?.waitUntil) {
    // Only the derived bytes are cached. Every request still checks current public eligibility above.
    const cachedHeaders = new Headers(headers); cachedHeaders.set('cache-control', 'public, max-age=86400');
    ctx.waitUntil(cache.put(cacheKey, new Response(jpeg, { headers: cachedHeaders })).catch(() => {}));
  }
  return new Response(request.method === 'HEAD' ? null : jpeg, { headers });
}
