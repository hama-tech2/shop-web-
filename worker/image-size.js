/** Read dimensions before decoding untrusted compressed pixels. No image allocation. */
export function imageSize(bytes) {
  const b = bytes, n = b.length;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (offset, count) => String.fromCharCode(...b.subarray(offset, offset + count));
  if (n >= 24 && ascii(1, 3) === 'PNG' && b[0] === 137 && ascii(12, 4) === 'IHDR')
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (n >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    let canvas = null, result = null;
    for (let offset = 12; offset + 8 <= n;) {
      const kind = ascii(offset, 4), length = view.getUint32(offset + 4, true), p = offset + 8;
      if (p + length > n) return null;
      if (kind === 'ANIM' || kind === 'ANMF') return null;
      if (kind === 'VP8X') {
        if (length !== 10 || (b[p] & 2)) return null; // No animated or unbounded frame sequences.
        canvas = { width: 1 + b[p+4] + (b[p+5]<<8) + (b[p+6]<<16), height: 1 + b[p+7] + (b[p+8]<<8) + (b[p+9]<<16) };
      }
      let frame;
      if (kind === 'VP8 ' && length >= 10 && b[p+3] === 157 && b[p+4] === 1 && b[p+5] === 42)
        frame = { width: view.getUint16(p+6, true) & 16383, height: view.getUint16(p+8, true) & 16383 };
      if (kind === 'VP8L' && length >= 5 && b[p] === 47)
        frame = { width: 1 + b[p+1] + ((b[p+2]&63)<<8), height: 1 + (b[p+2]>>6) + (b[p+3]<<2) + ((b[p+4]&15)<<10) };
      if (frame) {
        if (result) return null;
        result = frame;
      }
      offset = p + length + (length & 1);
    }
    // The container must not conceal a larger compressed frame behind a small canvas.
    if (canvas && (canvas.width !== result?.width || canvas.height !== result?.height)) return null;
    return result;
  }
  if (n >= 4 && b[0] === 255 && b[1] === 216) {
    let offset = 2;
    while (offset + 3 < n) {
      if (b[offset++] !== 255) return null;
      while (offset < n && b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 218 || marker === 217) return null;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > n) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > n) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7)
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      offset += length;
    }
  }
  return null;
}
