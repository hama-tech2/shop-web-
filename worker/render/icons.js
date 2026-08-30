/**
 * Inline SVG icons. Inlined rather than fetched so a cheap phone on a
 * slow connection paints the chrome in the first response.
 */

const svg = (body, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
  `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const iconSearch = (s = 20) =>
  svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>', s);

export const iconGlobe = (s = 20) =>
  svg(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
      '<path d="M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/>',
    s,
  );

export const iconHeart = (s = 18) =>
  svg(
    '<path d="M12 20s-7-4.4-7-9.1A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.9C19 15.6 12 20 12 20Z"/>',
    s,
  );

export const iconHome = (s = 22) =>
  svg('<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-5h5v5"/>', s);

export const iconUser = (s = 22) =>
  svg('<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.2-3.4 4-5 7-5s5.8 1.6 7 5"/>', s);

/* ---- public shop page ---- */

export const iconPin = (s = 14) =>
  svg('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>', s);

export const iconPhone = (s = 18) =>
  svg('<path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6.1 6.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/>', s);

export const iconShare = (s = 18) =>
  svg('<path d="M12 15V4"/><path d="m8.5 7.5 3.5-3.5 3.5 3.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>', s);

export const iconBack = (s = 22) => svg('<path d="m9 5 7 7-7 7"/>', s);

/** WhatsApp, Instagram, TikTok and Facebook marks — filled, brand shapes. */
const brand = (body, size) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const iconWhatsapp = (s = 20) =>
  brand(
    '<path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.4 0-.5s-.6-1.4-.8-1.9-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1 2.6 11.4 11.4 0 0 0 4.4 3.9c1.6.6 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.5-.3Z"/>',
    s,
  );

export const iconInstagram = (s = 18) =>
  brand(
    '<path d="M12 2.2c3.2 0 3.6 0 4.9.1a6 6 0 0 1 2 .4 4 4 0 0 1 2.4 2.4 6 6 0 0 1 .4 2c.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9a6 6 0 0 1-.4 2 4 4 0 0 1-2.4 2.4 6 6 0 0 1-2 .4c-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1a6 6 0 0 1-2-.4 4 4 0 0 1-2.4-2.4 6 6 0 0 1-.4-2c-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9a6 6 0 0 1 .4-2A4 4 0 0 1 5.1 2.7a6 6 0 0 1 2-.4c1.3-.1 1.7-.1 4.9-.1Zm0 3.3A6.5 6.5 0 1 0 18.5 12 6.5 6.5 0 0 0 12 5.5Zm0 10.7A4.2 4.2 0 1 1 16.2 12 4.2 4.2 0 0 1 12 16.2Zm6.8-10.9a1.5 1.5 0 1 1-1.5-1.5 1.5 1.5 0 0 1 1.5 1.5Z"/>',
    s,
  );

export const iconTiktok = (s = 18) =>
  brand(
    '<path d="M16.6 2h-3v13.1a2.4 2.4 0 1 1-2.4-2.4 2.5 2.5 0 0 1 .7.1v-3a5.5 5.5 0 1 0 4.7 5.4V8.9a6.6 6.6 0 0 0 3.9 1.3v-3a3.7 3.7 0 0 1-3.9-3.6V2Z"/>',
    s,
  );

export const iconFacebook = (s = 18) =>
  brand(
    '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9a15 15 0 0 1 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"/>',
    s,
  );
