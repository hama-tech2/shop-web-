// A review belongs to this admin session and these exact grant details.
// The token is used only as an HMAC key; it never appears in the form.
const bytes = new TextEncoder();
const key = (token) => crypto.subtle.importKey('raw', bytes.encode(token),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const message = (r) => bytes.encode(JSON.stringify(
  [r.shop, r.admin, r.plan, r.reason, r.request, r.until]));

export async function grantProof(token, review) {
  const signature = await crypto.subtle.sign('HMAC', await key(token), message(review));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function validGrantProof(token, review, proof) {
  if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)
      || !Number.isFinite(review.until) || review.until < Date.now()) return false;
  const signature = Uint8Array.from(proof.match(/../g), (b) => parseInt(b, 16));
  return crypto.subtle.verify('HMAC', await key(token), signature, message(review));
}
