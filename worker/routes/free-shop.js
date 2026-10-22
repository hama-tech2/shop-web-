import { APP_NAME, APP_NAME_LATIN, FREE_PRODUCT_LIMIT, SITE_ORIGIN } from '../config.js';
import { layout } from '../render/layout.js';
import { bottomNav } from '../render/appshell.js';
import { esc } from '../render/html.js';

/** Public seller information; no account, catalog read or new signup flow. */
export function freeShopGet() {
  const limit = new Intl.NumberFormat('ar-IQ').format(FREE_PRODUCT_LIMIT);
  const title = `دوکانی ئۆنلاین بەخۆڕایی لە کوردستان | ${APP_NAME_LATIN}`;
  const description = `لە ${APP_NAME} دوکانێکی کوردی بەخۆڕایی دروست بکە، ${limit} بەرهەم بێ کاتی بەسەرچوون بڵاو بکەوە و لینک یان کۆدی QR هاوبەش بکە.`;
  const body = `<div class="page"><main class="free-shop">` +
    `<a class="free-shop__back" href="/">گەڕانەوە بۆ ${esc(APP_NAME)}</a>` +
    `<h1>دوکانی ئۆنلاین بەخۆڕایی لە کوردستان</h1>` +
    `<p>${esc(description)}</p>` +
    `<p lang="en" dir="ltr">${esc(APP_NAME_LATIN)} helps sellers in Kurdistan create a free Kurdish online shop, list ${FREE_PRODUCT_LIMIT} products with no expiry, and share one shop link or QR code.</p>` +
    `<a class="seller-prompt__cta free-shop__start" href="/signup">دوکانە بەخۆڕاییەکەت دروست بکە</a>` +
    `<section aria-labelledby="free-shop-steps"><h2 id="free-shop-steps">چۆن دەست پێ بکەم؟</h2>` +
    `<ol><li>هەژمار دروست بکە و ناو و زانیارییەکانی دوکانەکەت بنووسە.</li>` +
    `<li>بەرهەمەکانت بە ناو، نرخ، وەسف و وێنەی خۆت زیاد بکە.</li>` +
    `<li>لینکی دوکانەکەت لە بایۆی TikTok و Instagram دابنێ، یان لە واتساپ بۆ کڕیارەکانت بینێرە.</li></ol></section>` +
    `<section aria-labelledby="free-shop-plan"><h2 id="free-shop-plan">پلانی بەخۆڕایی چی لەخۆ دەگرێت؟</h2>` +
    `<p>هەتا ${limit} بەرهەمی هەڵگیراو، بەرهەمە شاراوە و ئەرشیفکراوەکانیش لەگەڵیاندا، و هەتا ٥ وێنە بۆ هەر بەرهەمێک. پلانی بەخۆڕایی کاتی بەسەرچوونی نییە. بۆ زیادکردنی بەرهەمی ٣١ پێویستت بە پریمیەمە؛ یان بەرهەمێک بسڕەوە بۆ بەتاڵکردنەوەی شوێن.</p>` +
    `<p>بەرهەمەکانت دەتوانیت دەستکاری یان بسڕیتەوە؛ سڕینەوەی بەرهەم شوێنێک بەتاڵ دەکاتەوە.</p></section>` +
    `<section aria-labelledby="free-shop-share"><h2 id="free-shop-share">یەک لینک و کۆدی QR بۆ دوکانەکەت</h2>` +
    `<p>لە هەژمارەکەت لینکی ڕاستەوخۆی دوکانەکەت کۆپی بکە. کۆدی QR دابگرە و لە دوکانەکەت چاپی بکە؛ سکانکردنی کۆدەکە دوکان و بەرهەمە گشتییەکانت دەکاتەوە. ئەگەر لینکی دوکانەکەت بگۆڕیت، پێویستە QR ـە چاپکراوەکەش نوێ بکەیتەوە.</p></section>` +
    `<section aria-labelledby="free-shop-buy"><h2 id="free-shop-buy">کڕیارەکان چۆن بەرهەمەکان دەبینن؟</h2>` +
    `<p>بێ چوونەژوورەوە دوکانە گشتییەکەت، وێنە و نرخی بەرهەمەکان دەبینن و لە ڕێگای واتساپ پەیوەندیت پێوە دەکەن. داواکاری و ڕێککەوتنی کڕین لەگەڵ خودی دوکاندارە.</p>` +
    `<a class="free-shop__back" href="/">بینینی بەرهەمە ڕاستەقینەکانی دوکانەکان</a></section>` +
    `</main></div>${bottomNav(null)}`;
  return new Response(layout({ title, description, canonical: `${SITE_ORIGIN}/free-shop`, body, scripts: [] }), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
