/** Product-only cover editor. The shared profile cropper stays unchanged. */
export function productCover() {
  return `<dialog class="cover-editor" id="cover-editor" aria-labelledby="cover-title">` +
    `<header class="cover-head"><button type="button" id="cover-back" aria-label="گەڕانەوە">‹</button><h2 id="cover-title">کاڤەری بەرهەم</h2><button type="button" id="cover-preview">پێشبینین ◉</button></header>` +
    `<p class="cover-intro">کاڤەری سەرەکی هەڵبژێرە و ڕێکی بخە بۆ نیشاندانی بەرهەمەکەت.</p>` +
    `<p id="cover-message" class="publish-message" role="status" hidden></p>` +
    `<div class="cover-stage" id="cover-stage" tabindex="0" aria-label="ڕاکێشان بۆ جووڵاندنی وێنە؛ دوگمە تیرەکانیش کار دەکەن"><canvas id="cover-canvas"></canvas></div>` +
    `<div class="cover-controls"><div class="cover-rotations">` +
    `<button type="button" id="cover-reset">↺ گەڕانەوە</button><button type="button" id="cover-right">↻ بۆ ڕاست</button><button type="button" id="cover-left">↺ بۆ چەپ</button></div>` +
    `<div class="cover-adjust"><fieldset class="cover-ratios"><legend class="visually-hidden">ڕێژەی کاڤەر</legend><label><input type="radio" name="cover-ratio" value="1" checked><span dir="ltr">1:1</span></label><label><input type="radio" name="cover-ratio" value="1.25"><span dir="ltr">4:5</span></label></fieldset>` +
    `<div class="cover-zoom"><button type="button" id="cover-minus" aria-label="بچووککردنەوە">−</button><input id="cover-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="گەورەکردنی کاڤەر" dir="ltr"><button type="button" id="cover-plus" aria-label="گەورەکردن">+</button></div></div></div>` +
    `<p class="cover-selected">✓ ئەم وێنەیە دەبێتە کاڤەری سەرەکی.</p><div class="cover-strip" id="cover-strip" aria-label="هەڵبژاردنی وێنەی کاڤەر"></div>` +
    `<section class="cover-previews" id="cover-previews" tabindex="-1"><h3>پێشبینینی پێش کلیککردن</h3><div class="cover-preview-grid">` +
    `<div class="cover-example"><p>لە بازاڕ</p><div class="cover-market"><img id="cover-market-img" alt="پێشبینینی کاڤەر لە بازاڕ"><strong class="cover-preview-title"></strong><span class="cover-preview-price"></span></div></div>` +
    `<div class="cover-example"><p>لە لاپەڕەی دوکان</p><div class="cover-shop-grid"><span></span><img id="cover-shop-img" alt="پێشبینینی کاڤەر لە دوکان"><span></span><span></span><span></span><span></span></div></div></div></section>` +
    `<p class="cover-note">ⓘ ڕێکخستنەکان تەنها کاڤەر دەگۆڕن. هەموو وێنەکان بە تەواوی لە وردەکاریی بەرهەمەکە دەکرێنەوە.</p>` +
    `<footer class="cover-footer"><button type="button" id="cover-cancel">هەڵوەشاندنەوە</button><button class="btn btn--primary" type="button" id="cover-save">پاشەکەوت و بەردەوام بە</button></footer></dialog>`;
}
