import { PRODUCT as T } from '../config.js';
import { esc } from './html.js';

/**
 * The crop sheet, shared by the product form and the profile page.
 * Aspect-agnostic: the script sizes the frame from the ratio it is
 * given, so the same markup serves 4:5 products, 8:3 banners and
 * square logos.
 */
export function cropSheet() {
  return (
    `<div class="crop" id="crop" role="dialog" aria-modal="true" aria-labelledby="crop-title" hidden>` +
    `<div class="crop__bar">` +
    `<button class="crop__action" type="button" id="crop-cancel">${esc(T.cropCancel)}</button>` +
    `<span class="crop__title" id="crop-title">${esc(T.cropTitle)}</span>` +
    `<button class="crop__action crop__action--go" type="button" id="crop-done">` +
    `${esc(T.cropDone)}</button>` +
    `</div>` +
    `<div class="crop__stage" id="crop-stage" tabindex="0" aria-label="جووڵاندنی وێنە بە تیرەکان، گەورە و بچووککردن بە + و −">` +
    `<canvas class="crop__canvas" id="crop-canvas"></canvas>` +
    `<div class="crop__frame" aria-hidden="true"></div>` +
    `</div>` +
    `<div class="crop__tools">` +
    `<p class="crop__hint">${esc(T.cropHint)}</p>` +
    `<button class="btn btn--quiet" type="button" id="crop-rotate">${esc(T.rotate)}</button>` +
    `</div>` +
    `</div>`
  );
}
