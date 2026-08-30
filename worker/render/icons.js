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
