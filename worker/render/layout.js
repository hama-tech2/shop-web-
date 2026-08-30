import { APP_NAME } from '../config.js';
import { esc } from './html.js';

/**
 * The HTML shell. Server-rendered every time — the page is readable
 * before a single byte of JavaScript arrives, which is what makes the
 * shared link work for crawlers and for a phone on a bad connection.
 */
export function layout({ title, description, body, canonical, ogImage, scripts = ['/js/feed.js'] }) {
  return (
    `<!doctype html>` +
    `<html lang="ckb" dir="rtl">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
    `<meta name="theme-color" content="#FBF9F6">` +
    `<title>${esc(title)}</title>` +
    `<meta name="description" content="${esc(description)}">` +
    (canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '') +

    `<meta property="og:type" content="website">` +
    `<meta property="og:site_name" content="${esc(APP_NAME)}">` +
    `<meta property="og:title" content="${esc(title)}">` +
    `<meta property="og:description" content="${esc(description)}">` +
    (canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '') +
    (ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : '') +
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">` +

    `<link rel="preconnect" href="https://fonts.googleapis.com">` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?` +
    `family=Noto+Kufi+Arabic:wght@400;700&family=Vazirmatn:wght@400;500;700&display=swap">` +
    `<link rel="stylesheet" href="/styles/design-system.css">` +
    `<link rel="stylesheet" href="/styles/app.css">` +
    `<link rel="stylesheet" href="/styles/forms.css">` +
    `</head>` +
    `<body>${body}` +
    scripts.map((src) => `<script src="${esc(src)}" defer></script>`).join('') +
    `</body>` +
    `</html>`
  );
}
