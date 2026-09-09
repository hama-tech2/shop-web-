/** Product-only cover editor. The shared profile cropper stays unchanged. */
export function productCover() {
  return `<dialog class="cover-editor" id="cover-editor" aria-labelledby="cover-title">` +
    `<header class="cover-head"><button type="button" id="cover-back" aria-label="گەڕانەوە">‹</button><h2 id="cover-title">کاڤەری بەرهەم</h2></header>` +
    `<p class="cover-intro">وێنەکە ڕابکێشە بۆ جووڵاندن؛ بە دوو پەنجە گەورەی بکە. ڕێژەی کاڤەر <bdi>4:5</bdi> ـە.</p>` +
    `<p id="cover-message" class="publish-message" role="status" hidden></p>` +
    `<div class="cover-stage" id="cover-stage" tabindex="0" aria-label="ڕاکێشان بۆ جووڵاندنی وێنە؛ دوگمە تیرەکانیش کار دەکەن"><canvas id="cover-canvas"></canvas></div>` +
    `<div class="cover-controls"><button type="button" id="cover-rotate">↻ سووڕاندن</button>` +
    `<div class="cover-zoom"><button type="button" id="cover-minus" aria-label="بچووککردنەوە">−</button><input id="cover-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="گەورەکردنی کاڤەر" dir="ltr"><button type="button" id="cover-plus" aria-label="گەورەکردن">+</button></div></div>` +
    `<footer class="cover-footer"><button type="button" id="cover-cancel">هەڵوەشاندنەوە</button><button class="btn btn--primary" type="button" id="cover-save">پاشەکەوت و بەردەوام بە</button></footer></dialog>`;
}
