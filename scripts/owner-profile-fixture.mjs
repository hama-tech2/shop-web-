// Offline visual fixture, separate from production auth/data. Real renderers/assets.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from '../worker/render/layout.js';
import { appShell } from '../worker/render/appshell.js';
import { shopPage } from '../worker/render/shop.js';
import { shopQrPage } from '../worker/render/shop-qr.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = resolve(root, 'scripts/fixtures/owner-profile');
export async function ownerProfileFixture({ renderShell = appShell, renderShop = shopPage, assetRoot = resolve(root, 'public') } = {}) {
  const fixture = JSON.parse(await readFile(resolve(fixtureRoot, 'catalog.json'), 'utf8'));
  // Exercise a filled banner with an already-uploaded public product photo.
  // This assignment is local test data, not the production shop's saved cover.
  fixture.shop.cover_key = fixture.products[1].images[0];
  const category = n => 'dddddddd-0000-4000-8000-' + String(n).padStart(12, '0');
  let categories = ['کورسی', 'مێز', 'ژووری نوستن', 'ڕووناکی', 'دیکۆرات', 'ئەکسسوارات'].map((name, i) => ({ id: category(i + 1), name }));
  let nextCategory = 10;
  const writes = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const page = body => layout({ title: 'Bazaro — local owner preview', description: 'Local UI fixture', body, scripts: ['/js/draft-store.js'] })
        .replace(/href="https:\/\/fonts.googleapis.com\/css2\?[^"]+"/, 'href="/__owner-fonts/fonts.css"');
      const send = (body, type = 'text/html; charset=utf-8', status = 200) => { response.writeHead(status, { 'content-type': type }); response.end(body); };
      if (url.pathname === '/app') return send(page(renderShell({ shop: fixture.shop, origin: 'https://bazarnow.xyz' })));
      if (url.pathname === '/app/owner-products') return send(renderShop({ shop: fixture.shop, products: fixture.products,
        categories: [], shopCategories: categories, activeCategory: url.searchParams.get('category') || '', origin: 'https://bazarnow.xyz', owner: true }));
      if (url.pathname === '/app/qr') return send(layout({ title: 'QR fixture', description: '', body: shopQrPage({ shop: fixture.shop }),
        scripts: ['/js/vendor/qrcode-generator-2.0.4.js', '/js/shop.js', '/js/shop-qr.js'] }));
      if (request.method === 'POST' && url.pathname.startsWith('/api/categories')) {
        let raw = ''; for await (const part of request) raw += part;
        const values = Object.fromEntries(new URLSearchParams(raw));
        writes.push({ path: url.pathname, values });
        if (url.pathname === '/api/categories') { const row = { id: category(nextCategory++), name: values.name }; categories.push(row); return send(JSON.stringify(row), 'application/json'); }
        const id = url.pathname.split('/')[3];
        if (url.pathname.endsWith('/delete')) { categories = categories.filter(row => row.id !== id); return send('{}', 'application/json'); }
        const row = categories.find(row => row.id === id); row.name = values.name; return send(JSON.stringify(row), 'application/json');
      }
      if (url.pathname.startsWith('/img/')) {
        const key = url.pathname.slice(5).split('/').map(decodeURIComponent).join('/');
        const image = fixture.images[key];
        if (image) return send(await readFile(resolve(fixtureRoot, image.file)), image.type);
        return send('Missing fixture image', 'text/plain', 404);
      }
      if (/^\/__owner-fonts\/[a-z0-9.-]+$/i.test(url.pathname)) {
        return send(await readFile(resolve(fixtureRoot, 'fonts', url.pathname.split('/').at(-1))), url.pathname.endsWith('.css') ? 'text/css' : 'font/ttf');
      }
      const publicRoot = resolve(assetRoot);
      const file = resolve(publicRoot, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(publicRoot + sep)) return send('Not found', 'text/plain', 404);
      const types = { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
      return send(await readFile(file), types[extname(file)] || 'application/octet-stream');
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, fixture, writes,
    close: () => new Promise(resolve => server.close(resolve)) };
}
