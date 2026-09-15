/**
 * Shop Web — app-wide config.
 *
 * APP_NAME is the placeholder brand. It appears in the header, the page
 * title and the OG tags — change it HERE and nowhere else.
 */
export const APP_NAME = 'بازاڕۆ';

/**
 * The same brand in Latin script.
 *
 * Used where a crawler, an app store or an operating system reads the
 * name rather than a Sorani speaker: og:site_name, the web manifest,
 * the apple-touch title. The visible UI stays Kurdish.
 */
export const APP_NAME_LATIN = 'Bazaro';

/**
 * The brand assets, generated from public/brand/bazaro-logo.png by
 * `node scripts/brand-icons.mjs`. Paths only — the generator owns the
 * sizes, and scripts/brand-assets-test.mjs fails if any is missing.
 */
export const BRAND = {
  logo: '/brand/bazaro-logo.png',
  icon16: '/brand/favicon-16.png',
  icon32: '/brand/favicon-32.png',
  icon48: '/brand/favicon-48.png',
  ico: '/favicon.ico',
  appleTouch: '/brand/apple-touch-icon.png',
  icon192: '/brand/icon-192.png',
  icon512: '/brand/icon-512.png',
  manifest: '/site.webmanifest',
  // The share card for a page that has no image of its own. A seller's
  // own link never uses this: /@slug prefers their cover, then their
  // logo, then their first product.
  ogImage: '/brand/og-default.png',
  ogWidth: 1200,
  ogHeight: 630,
};

/**
 * The one line under the name. Deliberately not a place: Bazaro is not
 * an Erbil-only product, and a city in the tagline tells a seller in
 * Sulaymaniyah or Duhok that it is not for them. It says what the app
 * does instead — one link that is the whole shop.
 */
export const APP_TAGLINE = 'دوکانەکەت لە یەک بەستەردا';

/** Products per page. The feed asks for one extra to know if more exist. */
export const PAGE_SIZE = 6;

/** Auto-slide interval for multi-image cards, in ms. */
export const SLIDE_MS = 4000;

/**
 * Category chips, in order. `slug` matches platform_categories.slug;
 * `null` is the "all" chip.
 */
export const CHIPS = [
  { slug: null,          label: 'هەموو' },
  { slug: 'clothing',    label: 'جل و بەرگ' },
  { slug: 'beauty',      label: 'جوانکاری و عەتر' },
  { slug: 'home',        label: 'ماڵەوە' },
  { slug: 'electronics', label: 'ئەلیکترۆنی' },
  { slug: 'food',        label: 'خواردن' },
  { slug: 'other',       label: 'ئەوانی تر' },
];

/** Language sheet. Only Kurdish is wired up; the rest are placeholders. */
export const LOCALES = [
  { code: 'ckb', label: 'کوردی',    ready: true  },
  { code: 'ar',  label: 'عەرەبی',   ready: false },
  { code: 'en',  label: 'English',  ready: false },
];

export const UI = {
  searchPlaceholder: 'گەڕان بۆ کاڵا',
  loadMore: 'زیاتر ببینە',
  loading: 'چاوەڕێ بکە…',
  emptyTitle: 'هیچ کاڵایەک نەدۆزرایەوە',
  emptyBody: 'هەوڵ بدە جۆرێکی تر هەڵبژێریت.',
  /**
   * The PLATFORM currency: what a shop pays us, through Wayl. Always
   * IQD, and not the same thing as what a shop charges a customer —
   * that is per product now, and lives in PRODUCT_CURRENCIES below.
   */
  currency: 'IQD',
  language: 'زمان',
  soon: 'بەم زووانە',
  save: 'پاشەکەوتکردن',
  tabFeed: 'بۆ تۆ',
  tabAccount: 'هەژمارم',

  /**
   * The one line on the feed that tells a shopkeeper this is for them.
   *
   * It sits in the scroll and scrolls away: no sticky bar, no fade, no
   * timer. A customer reads it once and never thinks about it again,
   * which is the most an advert on somebody's shopping feed should ask.
   */
  sellerPrompt: 'دوکانداریت هەیە؟ دوکانەکەت دروست بکە و بەرهەمەکانت بڵاو بکەوە',
  sellerCta: 'دوکان دروست بکە',
};

/**
 * The Account tab, for somebody who is not signed in.
 *
 * Tapping it used to drop a shopper straight into a login form, which
 * says, wrongly, that they need an account to be here. They do not:
 * browsing and messaging a shop over WhatsApp need nothing. An account
 * is for the other kind of visitor — the one with something to sell.
 */
export const VISITOR = {
  title: 'هەژمار',
  back: 'گەڕانەوە',
  noAccountNeeded: 'بۆ کڕین و گەڕان پێویست بە هەژمار نییە',
  sellerBody: 'ئەگەر دوکانت هەیە، بە هەژمار بەرهەمەکانت بڵاو بکەرەوە.',
  google: 'بەردەوام بە Google',
  forgot: 'وشەی نهێنیت لەبیر کردووە؟',
  showPassword: 'پیشاندانی وشەی نهێنی',
};

/**
 * The two currencies a product can be priced in.
 *
 * A seller in Erbil quotes clothes in dinars and a phone in dollars,
 * and before this the form only offered dinars — so the ones who meant
 * dollars wrote "$" into the product title to say so.
 *
 * `lead` is which side the symbol goes: `$25`, but `25,000 د.ع`. It is
 * the whole reason this is a table rather than a map of symbols, since
 * the two currencies do not agree on where the symbol belongs.
 *
 * Nothing here converts. A price is the number the seller typed in the
 * currency they picked; the app never holds a rate, and switching the
 * selector leaves the number exactly as it was.
 *
 * Unrelated to UI.currency above, which is what a shop pays us.
 */
export const PRODUCT_CURRENCIES = {
  IQD: { code: 'IQD', symbol: 'د.ع', label: 'دیناری عێراقی', lead: false, decimals: 0 },
  USD: { code: 'USD', symbol: '$',   label: 'دۆلار',         lead: true,  decimals: 0 },
};

/** The default, and what every product created before this was. */
export const DEFAULT_CURRENCY = 'IQD';

/** The currency selector on the product form. */
export const CURRENCY_UI = {
  legend: 'دراو',
  hint: 'دراوەکە هەڵبژێرە. گۆڕینی دراو نرخەکە ناگۆڕێت.',
};

/** Auth, onboarding and app-shell strings. */
export const AUTH = {
  signupTitle: 'هەژمارێک دروست بکە',
  signupSub: 'دوکانەکەت دروست بکە و لینکی خۆت وەربگرە.',
  loginTitle: 'چوونە ژوورەوە',
  loginSub: 'بەخێربێیتەوە.',
  email: 'ئیمەیڵ',
  password: 'وشەی نهێنی',
  passwordNew: 'وشەی نهێنی نوێ',
  passwordHint: 'لانیکەم ٨ پیت.',
  signupBtn: 'دروستکردنی هەژمار',
  loginBtn: 'چوونە ژوورەوە',
  google: 'بەردەوامبوون بە گووگڵ',
  or: 'یان',
  haveAccount: 'هەژمارت هەیە؟',
  noAccount: 'هەژمارت نییە؟',
  goLogin: 'بچۆ ژوورەوە',
  goSignup: 'هەژمار دروست بکە',
  forgot: 'وشەی نهێنیت لەبیرچووە؟',
  forgotTitle: 'وشەی نهێنی نوێ',
  forgotSub: 'ئیمەیڵەکەت بنووسە و لینکێکت بۆ دەنێرین.',
  forgotBtn: 'ناردنی لینک',
  forgotSent: 'ئەگەر ئەو ئیمەیڵە تۆمارکرابێت، لینکێکمان بۆ نارد. ئینبۆکس بپشکنە.',
  resetTitle: 'وشەی نهێنی نوێ دابنێ',
  resetBtn: 'پاشەکەوتکردن',
  resetDone: 'وشەی نهێنی گۆڕدرا.',
  logout: 'دەرچوون',

  errEmail: 'ئیمەیڵێکی دروست بنووسە.',
  errPassword: 'وشەی نهێنی دەبێت لانیکەم ٨ پیت بێت.',
  errCredentials: 'ئیمەیڵ یان وشەی نهێنی هەڵەیە.',
  errTaken: 'ئەم ئیمەیڵە پێشتر تۆمارکراوە.',
  errGeneric: 'هەڵەیەک ڕوویدا. دووبارە هەوڵ بدەرەوە.',
  // Shown when this address has made too many accounts too quickly, and
  // when the limiter itself cannot run. Says the same thing either way:
  // a caller learns nothing about which it was, and a real seller reads
  // something they can act on.
  errTooMany: 'داواکاری زۆر لەم ئامێرەوە. تکایە چەند خولەکێک چاوەڕێ بکە و دووبارە هەوڵ بدەرەوە.',
  errSession: 'دانیشتنەکەت بەسەرچووە. دووبارە بچۆ ژوورەوە.',
};

export const ONBOARDING = {
  stepOf: (n, total) => `هەنگاوی ${n} لە ${total}`,

  nameTitle: 'ناوی دوکانەکەت',
  nameSub: 'ئەم ناوە لە پرۆفایلەکەت دەردەکەوێت.',
  nameLabel: 'ناوی دوکان',
  namePlaceholder: 'بۆ نموونە: بۆتیکی نافین',

  slugTitle: 'لینکی تایبەت بە تۆ',
  slugSub: 'ئەمە ئەو لینکەیە کە لە تیک تۆک و ئینستاگرام بڵاوی دەکەیتەوە.',
  slugLabel: 'ناوی لینک',
  slugChecking: 'پشکنین…',
  slugOk: 'بەردەستە',
  slugTaken: 'ئەم لینکە وەرگیراوە.',
  slugReserved: 'ئەم ناوە پارێزراوە، ناوێکی تر هەڵبژێرە.',
  slugFormat: 'تەنها پیتی ئینگلیزی بچووک، ژمارە و - بەکاربهێنە (٣ تا ٤٠ پیت).',

  contactTitle: 'پەیوەندی',
  contactSub: 'کڕیارەکان لەڕێی واتساپەوە داوای کاڵا دەکەن.',
  cityLabel: 'شار',
  whatsappLabel: 'ژمارەی واتساپ',
  whatsappPlaceholder: '+9647501234567',
  errWhatsapp: 'ژمارەکە بەم شێوەیە بنووسە: +9647501234567',
  // The shop is created at the end of this step, so this is where the
  // second gate speaks. Same wording as signup, and the same silence
  // about whether the limiter refused or could not run.
  errTooMany: 'داواکاری زۆر لەم ئامێرەوە. تکایە چەند خولەکێک چاوەڕێ بکە و دووبارە هەوڵ بدەرەوە.',

  logoTitle: 'لۆگۆی دوکان',
  logoSub: 'دەتوانیت ئێستا بیکەیت یان دواتر.',
  logoPick: 'هەڵبژاردنی وێنە',
  logoHint: 'JPG، PNG یان WebP. زۆرترین ٥ مێگابایت.',
  errLogoType: 'تەنها JPG، PNG یان WebP.',
  errLogoSize: 'وێنەکە زۆر گەورەیە. زۆرترین ٥ مێگابایت.',

  next: 'دواتر',
  back: 'گەڕانەوە',
  skip: 'تێپەڕاندن',
  finish: 'تەواوکردن',
};

export const APP_UI = {
  title: 'هەژمارم',
  yourLink: 'لینکی دوکانەکەت',
  copy: 'کۆپی',
  copied: 'کۆپی کرا',
  shopName: 'ناوی دوکان',
  city: 'شار',
  whatsapp: 'واتساپ',
  soon: 'بەم زووانە: زیادکردنی بەرهەم، دەستکاری پرۆفایل، ئامارەکان.',
};

/** Cities the wizard offers. */
export const CITIES = [
  { value: 'erbil',      label: 'هەولێر' },
  { value: 'sulaymaniyah', label: 'سلێمانی' },
  { value: 'duhok',      label: 'دهۆک' },
  { value: 'kirkuk',     label: 'کەرکووک' },
  { value: 'halabja',    label: 'هەڵەبجە' },
  { value: 'zakho',      label: 'زاخۆ' },
  { value: 'other',      label: 'شوێنێکی تر' },
];

/** Add / edit product, and the products list. */
export const PRODUCT = {
  newTitle: 'زیادکردنی بەرهەم',
  editTitle: 'دەستکاری بەرهەم',
  listTitle: 'بەرهەمەکانم',
  // One list holds everything, so the help line says what a tap does
  // rather than explaining a filter that no longer exists.
  listHelp: 'بۆ دەستکاری یان گۆڕینی دۆخی بەرهەم، لەسەری بدە.',
  add: 'زیادکردنی بەرهەم',

  photos: 'وێنەکان',
  photosHint: 'یەکەم وێنە دەبێتە وێنەی سەرەکی.',
  cover: 'سەرەکی',
  addPhoto: 'زیادکردنی وێنە',
  removePhoto: 'لابردنی وێنە',
  counter: (n, max) => `${n} / ${max}`,
  onlyMax: 'تەنها ٥ وێنە هەتایە.',

  cropTitle: 'ڕێکخستنی وێنە',
  cropHint: 'ڕایبکێشە و گەورەی بکە.',
  rotate: 'سووڕاندن',
  cropCancel: 'لابردن',
  cropDone: 'دواتر',

  titleLabel: 'ناوی بەرهەم',
  titlePlaceholder: 'بۆ نموونە: کراسی کوردی',
  priceLabel: 'نرخ',
  pricePlaceholder: '25,000',
  categoryLabel: 'جۆر',
  categoryNone: 'بێ جۆر',
  descriptionLabel: 'وەسف',
  descriptionPlaceholder: 'زانیاری زیاتر لەسەر بەرهەمەکە…',
  optional: 'ئارەزوومەندانە',
  visibility: 'دەرکەوتن',
  visible: 'دیارە',
  hidden: 'شاراوەیە',

  save: 'پاشەکەوتکردن',
  saving: 'پاشەکەوت دەکرێت…',
  uploading: 'ناردن…',
  delete: 'سڕینەوە',
  deleteConfirm: 'دڵنیایت لە سڕینەوەی ئەم بەرهەمە؟',
  edit: 'دەستکاری',

  errNoImage: 'لانیکەم یەک وێنە زیاد بکە.',
  errTitle: 'ناوی بەرهەم دەبێت لانیکەم ٢ پیت بێت.',
  errPrice: 'نرخێکی دروست بنووسە.',
  errCurrency: 'دراوێکی دروست هەڵبژێرە.',
  errUpload: 'ناردنی وێنە سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.',
  errType: 'تەنها JPG، PNG یان WebP.',
  errSave: 'پاشەکەوتکردن سەرکەوتوو نەبوو.',
  // Nothing was changed: the row is gone, or it was never this
  // seller's to change. Both must say so instead of claiming success.
  errGone: 'ئەم بەرهەمە نەدۆزرایەوە. لەوانەیە پێشتر سڕابێتەوە.',

  // Five products may be public at once on Free. The seller is not
  // stuck: hiding one of the five makes room for this one, and nothing
  // they own is going anywhere in the meantime.
  errPublicFull: (n) =>
    `لە پلانی بەخۆڕاییدا تەنها ${n} بەرهەم دەتوانن ئاشکرا بن. ` +
    'یەکێکیان بشارەوە، یان پلانێک بکڕە. هیچ بەرهەمێکت نەسڕاوەتەوە.',

  // The trial limit. A refusal on its own leaves the seller stuck, so
  // the message says what to do next and the screen carries the link.
  trialLimitTitle: 'پلانی بەخۆڕایی پڕە',
  trialLimitBody: (max) =>
    `لە پلانی بەخۆڕاییدا تا ${max} بەرهەم لە هەژمارەکەتدا دەتوانیت هەبێت. ` +
    'بۆ زیادکردنی بەرهەمێکی نوێ، یەکێک بسڕەوە یان پلانێک بکڕە. بەرهەمە ئێستاکانت پارێزراون.',
  trialLimitAction: 'بینینی پلانەکان',
  trialLeft: (n, max) => `${n} لە ${max} شوێنی پلانی بەخۆڕاییت ماوە.`,

  emptyTitle: 'هێشتا هیچ بەرهەمێکت نییە',
  emptyBody: 'یەکەم بەرهەمت زیاد بکە و لینکەکەت بڵاوبکەرەوە.',
};

/** Filter chips on the products list. */
export const PRODUCT_FILTERS = [
  { key: 'all',      label: 'هەموو',    status: null },
  { key: 'visible',  label: 'دیارەکان', status: 'active' },
  { key: 'hidden',   label: 'شاراوەکان', status: 'hidden' },
  { key: 'archived', label: 'ئەرشیف',   status: 'archived' },
];

/** Browser-side resize targets. Never upscale past the source. */
export const IMAGE_VARIANTS = {
  card: { width: 800,  height: 1000, quality: 0.75 },
  full: { width: 1200, height: 1500, quality: 0.82 },
};

// Locked product decision: five images per product. The database
// enforces the same number (trigger + save_product_images), so client
// and server cannot drift apart.
export const MAX_IMAGES = 5;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The public shop page and the product page — the shared link. */
export const SHOP = {
  productsTitle: 'بەرهەمەکان',
  all: 'هەموو',
  whatsappOrder: 'داوای کاڵا لەم واتەسابە',
  whatsappShop: 'پەیوەندی بە واتساپ',
  call: 'پەیوەندی',
  instagram: 'ئینستاگرام',
  tiktok: 'تیک تۆک',
  facebook: 'فەیسبووک',
  snapchat: 'سناپچات',
  mapsOpen: 'شوێنەکەمان لە نەخشە',
  share: 'بڵاوکردنەوە',
  save: 'پاشەکەوتکردن',
  linkCopied: 'لینک کۆپی کرا',

  expiredTitle: 'ئەم دوکانە لە ئێستادا نوێ نەکراوەتەوە',
  expiredBody: 'بەرهەمەکان کاتییانە شاراوەن. دەتوانیت هێشتا پەیوەندی بە خاوەن دوکان بکەیت.',

  emptyTitle: 'بەم زووانە',
  emptyBody: 'ئەم دوکانە هێشتا بەرهەمی زیاد نەکردووە. پەیوەندی بکە بۆ زانیاری زیاتر.',

  notFoundTitle: 'ئەم دوکانە نەدۆزرایەوە',
  notFoundBody: 'لەوانەیە لینکەکە هەڵە بێت.',

  moreFromShop: 'زیاتر لەم دوکانە',
  viewShop: 'بینینی دوکان',
  backToShop: 'گەڕانەوە',

  /** wa.me needs digits only. */
  waNumber: (raw) => String(raw || '').replace(/[^0-9]/g, ''),

  /** Pre-filled Sorani order message. Product name, then the link. */
  orderText: (productTitle, url) =>
    `سڵاو 👋\nحەزم لەم بەرهەمەیە: ${productTitle}\n${url}\nهێشتا بەردەستە؟`,

  shopText: (shopName, url) =>
    `سڵاو 👋\nدوکانەکەتم بینی: ${shopName}\n${url}`,
};

/** City slug -> Sorani label, for the pin under the shop name. */
export const CITY_LABEL = {
  erbil: 'هەولێر',
  sulaymaniyah: 'سلێمانی',
  duhok: 'دهۆک',
  kirkuk: 'کەرکووک',
  halabja: 'هەڵەبجە',
  zakho: 'زاخۆ',
  other: '',
};

/** Profile, categories and subscription — the seller's account screens. */
export const PROFILE = {
  title: 'پرۆفایلی فرۆشیار',
  save: 'پاشەکەوتکردن',
  saving: 'پاشەکەوت دەکرێت…',
  saved: 'پاشەکەوت کرا',

  linkLabel: 'لینکی دوکانەکەت',
  copy: 'کۆپی',
  copied: 'کۆپی کرا',
  viewShop: 'بینینی دوکانەکەم',

  changeBanner: 'گۆڕینی بەنەر',
  changeLogo: 'گۆڕینی لۆگۆ',

  nameLabel: 'ناوی دوکان',
  bioLabel: 'بایۆ',
  bioPlaceholder: 'بە کورتی باسی دوکانەکەت بکە…',
  cityLabel: 'شار',
  whatsappLabel: 'ژمارەی واتساپ',
  phoneLabel: 'ژمارەی تەلەفۆن',
  socialLabel: 'سۆشیال',

  mapsLabel: 'شوێنی دوکان لە نەخشە',
  mapsHint: 'لینکی Google Maps لێرە بلکێنە. تەنها لینکی https قبوڵ دەکرێت.',
  mapsPlaceholder: 'https://maps.app.goo.gl/…',
  mapsOpen: 'شوێنەکەمان لە نەخشە',
  snapchatLabel: 'Snapchat',
  linkCopy: 'کۆپیکردنی لینک',

  errName: 'ناوی دوکان دەبێت لانیکەم ٢ پیت بێت.',
  errWhatsapp: 'ژمارەی واتساپ بەم شێوەیە بنووسە: 07501234567',
  errPhone: 'ژمارەی تەلەفۆن دروست نییە.',
  errHandle: 'تەنها پیت، ژمارە، . و _ بەکاربهێنە.',
  errMaps: 'لینکی نەخشە دەبێت بە https:// دەست پێبکات.',
  errImage: 'ناردنی وێنە سەرکەوتوو نەبوو.',
  errType: 'تەنها JPG، PNG یان WebP.',
};

export const BIO_MAX = 120;

export const CATEGORIES_UI = {
  title: 'جۆرەکانی دوکانەکەم',
  intro: 'جۆرەکانی خۆت دروست بکە. لە پەڕەی دوکانەکەت وەک چیپ دەردەکەون.',
  nameLabel: 'ناوی جۆر',
  placeholder: 'بۆ نموونە: عەتری ژنانە',
  add: 'زیادکردن',
  rename: 'گۆڕینی ناو',
  remove: 'سڕینەوە',
  up: 'بۆ سەرەوە',
  down: 'بۆ خوارەوە',
  save: 'پاشەکەوتکردن',
  counter: (n, max) => `${n} / ${max}`,
  removeConfirm: 'دڵنیایت؟ بەرهەمەکان ناسڕێنەوە، تەنها لەم جۆرە دەردەچن.',
  emptyTitle: 'هێشتا هیچ جۆرێکت نییە',
  emptyBody: 'یەکەم جۆرت زیاد بکە.',
  errName: 'ناوێک بنووسە (١ بۆ ٦٠ پیت).',
  errDuplicate: 'ئەم ناوە پێشتر هەیە.',
  errLimit: 'تەنها ٢٠ جۆر هەتایە.',
  errGone: 'ئەم جۆرە نەدۆزرایەوە. لەوانەیە پێشتر سڕابێتەوە.',
  productCategory: 'جۆری دوکانەکەت',
  none: 'هیچ',

  // Inline creation, from inside the product form and the owner profile.
  addInline: '+ بەشی نوێ',
  addPlaceholder: 'ناوی بەشی نوێ',
  create: 'دروستکردن',
  cancel: 'پاشگەزبوونەوە',
  manage: 'ڕێکخستن',
  done: 'تەواو',
  errCreate: 'بەشەکە دروست نەکرا. دووبارە هەوڵ بدەرەوە.',
  deleteConfirm: 'ئەم بەشە بسڕدرێتەوە؟ بەرهەمەکان نەسڕدرێنەوە — تەنها بێ بەش دەبن.',
};

export const MAX_CATEGORIES = 20;

export const SUBSCRIPTION = {
  title: 'پلانی بەشداریکردن',

  // The five states a seller can be in. Only trial, pending and active
  // are stored; grace and expired are read off the expiry date.
  stateTrial: () => 'پلانی بەخۆڕایی',
  stateTrialLast: 'پلانی بەخۆڕایی',
  statePending: 'چاوەڕوانی پشتڕاستکردنەوە',
  stateActive: (d) => `چالاکە تا ${d}`,
  stateGrace: (n) => `بەسەرچووە — ${n} ڕۆژ ماوە پێش شاردنەوەی بەرهەمەکان`,
  stateExpired: 'پلانی پارەدراوت تەواو بووە. بەرهەمەکانت پارێزراون؛ لە بەڕێوەبردنی بەرهەمەکان دۆخیان بگۆڕە.',

  best: 'باشترین نرخ',
  perMonth: (n) => `${n} مانگانە`,

  /**
   * What the seller is about to be charged, said on the button that
   * takes them to Wayl.
   *
   * The plans are talked about in dollars and paid in dinars, so the
   * dinar figure has to be on the screen BEFORE they leave — nobody
   * should meet a number for the first time on somebody else's site.
   */
  chargeNotice: (iqd) => `${iqd} د.ع لە Wayl دەدەیت`,
  priceUsdNote: (usd) => `نزیکەی $${usd}`,
  savings: 'لە بەرامبەر ٦ مانگ پاشەکەوت دەکەیت',

  // The free month, named at the bottom of the plans, small. It is
  // what a seller is already on, not something to sell them.
  freeTitle: 'پلانی بەخۆڕایی',
  freeBody: (n) => `تا ${n} بەرهەم.`,

  whatYouGet: 'چی وەردەگریت',
  benefits: [
    'تا ١٠٠٠ بەرهەم بەبێ سنوور',
    'بەستەری تایبەت بۆ دوکانەکەت',
    'دەرکەوتن لە بەشی بۆ تۆ',
    'پشتگیری خێرا',
  ],

  pay: 'پارەدان',
  payVia: 'پارەدان لە ڕێگەی FIB',

  // ---- the Free plan, said where a seller meets one of its two
  // limits: five products, one image each. Nothing here starts or ends
  // anything — Free is where every shop already is. ----
  freeName: 'پلانی بەخۆڕایی',
  freeAllowance: (n, i) => `تا ${n} بەرهەم، هەر بەرهەمێک ${i} وێنە.`,
  freeSlotsLeft: (n) => `${n} شوێنی بەتاڵت ماوە.`,
  freeFull: (n) => `سنووری ${n} بەرهەمی پلانی بەخۆڕایی پڕە. ` +
    'بەرهەمێک بسڕەوە، یان پلانێک بکڕە.',
  freeImageOnly: (i) => `لە پلانی بەخۆڕاییدا هەر بەرهەمێک ${i} وێنەی هەیە.`,
  errFreeFull: 'پلانی بەخۆڕایی پڕە. بەرهەمێک بسڕەوە یان پلانێک بکڕە.',
  errSuspended: 'دوکانەکەت ناچالاکە. پەیوەندیمان پێوە بکە.',

  // ---- the plan gate, met on the way in to Add Product. Looking at it
  // starts nothing and writes nothing. ----
  gateTitle: 'بۆ زیادکردنی بەرهەم پلانێک هەڵبژێرە',
  gateBody: 'بەخۆڕایی بەردەوام بە، یان پلانێکی پارەدراو هەڵبژێرە.',
  gateTrialTitle: () => 'پلانی بەخۆڕایی',
  gateTrialBody: (n) => `تا ${n} بەرهەم. هیچ پارەیەک وەرناگیرێت.`,
  gateTrialAction: 'بەردەوامبوون بەخۆڕایی',
  gateTrialOnce: 'پلانی بەخۆڕایی.',
  gateTrialUsed: 'پلانی بەخۆڕایی پڕە. بەرهەمێک بسڕەوە یان پلانێک بکڕە.',
  gatePlans: 'پلانەکان',
  gateBack: 'گەڕانەوە',

  // ---- what the Account card says as the end approaches ----
  warnSoon: (n) => `${n} ڕۆژ لە پلانەکەت ماوە.`,
  warnUrgent: (n) => `تەنها ${n} ڕۆژ ماوە.`,
  warnLast: 'سبەی پلانەکەت تەواو دەبێت.',
  warnExpired: 'پلانی پارەدراوت تەواو بووە. سنوورەکانی پلانی بەخۆڕایی بەکاردێن.',
  warnNone: 'هێشتا پلانێکت نییە.',
  warnAction: 'نوێکردنەوە / بینینی پلانەکان',
  // Renewal is a payment the seller makes, every time. Nothing here
  // renews by itself and nothing may say that it does.
  renewManual: 'نوێکردنەوە دەستییە: کاتێک پلانەکە تەواو دەبێت خۆت پارەکە دەدەیتەوە.',

  errTrial: 'بەردەوامبوون سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.',
  errTrialUsed: 'بۆ بەردەوامبوون، پلانی بەخۆڕایی یان پلانێکی پارەدراو هەڵبژێرە.',
  errTrialActive: 'پلانێکی چالاکت هەیە.',

  // ---- the instructions screen ----
  payTitle: 'ڕێنمایی پارەدان',
  payPlan: 'پلان',
  payAmount: 'بڕی پارە',
  payReference: 'کۆدی ئاماژە',
  payFib: 'ژمارەی FIB',
  payNote: 'کۆدەکە لە تێبینی ناردنەکەدا بنووسە بۆ ئەوەی زوو بدۆزرێتەوە.',
  paySent: 'پارەکەم نارد',
  payCopy: 'کۆپی',
  payCopied: 'کۆپی کرا',
  // Never a success state before the owner has actually seen the money.
  payWaitingTitle: 'چاوەڕوانی پشتڕاستکردنەوە',
  payWaitingBody:
    'ناردنەکەت تۆمار کرا. کاتێک پارەکە بدۆزرێتەوە، پلانەکەت چالاک دەکرێت. ' +
    'ئەگەر پرسیارت هەیە، لە واتساپەوە پەیوەندیمان پێوە بکە.',
  paySafety: 'هەرگیز داوای PIN، ووشەی نهێنی یان ژمارەی کارتت لێ ناکەین.',
  payWhatsapp: 'پەیوەندی بە واتساپ',
  payBack: 'گەڕانەوە بۆ پلانەکان',
  payCancel: 'هەڵوەشاندنەوەی داواکاری',

  // ---- history ----
  historyTitle: 'مێژووی پارەدان',
  historyEmpty: 'هێشتا هیچ پارەدانێک نییە.',
  historyDate: 'بەروار',
  historyAmount: 'بڕ',
  historyStatus: 'دۆخ',
  historyConfirmed: 'پشتڕاستکراوە',
  historyPending: 'چاوەڕوانی پشتڕاستکردنەوە',

  // ---- Wayl hosted checkout ----
  // Nothing here ever claims a payment succeeded. Only the server
  // asking Wayl and getting an answer does that.
  resultSlow: 'هێشتا پشکنین بەردەوامە. ئەمە هەندێک جار چەند خولەکێک دەخایەنێت. ' +
    'دەتوانیت ئەم لاپەڕەیە دابخەیت — پارەدانەکەت هەڵناوەشێتەوە.',

  errPlan: 'پلانەکە نەناسرایەوە.',
  errUnavailable: 'پارەدانی ئۆنلاین هێشتا چالاک نەکراوە. هیچ پارەیەک لێت وەرناگیرێت.',
  errCheckout: 'دەستپێکردنی پارەدان سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.',
  errBusy: 'داواکاری زۆر. تکایە چەند خولەکێک چاوەڕێ بکە و دووبارە هەوڵ بدەوە.',

  // Two failures that are not the seller's and are not a reason to
  // keep tapping. errConfig is ours — something is unset on the server
  // — and errProvider is Wayl being unreachable. Both say "not your
  // fault, not now", because telling somebody to try again when
  // trying again cannot work is its own small cruelty.
  errConfig: 'پارەدان لە ئێستادا ڕێک نەخراوە. هەڵەکە لای ئێمەیە — پەیوەندیمان پێوە بکە.',
  errProvider: 'Wayl لە ئێستادا بەردەست نییە. تکایە دوایی هەوڵ بدەوە.',
  errIntent: 'داواکارییەکە دروست نەکرا. تکایە دووبارە هەوڵ بدەوە.',
  errSent: 'تۆمارکردنی ناردنەکە سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.',
};

/**
 * The Telegram messages the owner gets.
 *
 * Only the owner ever sees these, so they are the one place in the app
 * where brevity beats explanation: he is reading them on a lock screen
 * and deciding whether to tap a button.
 *
 * Sellers are never messaged on Telegram.
 */
export const TELEGRAM = {
  newPayment: 'پارەدانی نوێ',
  plan: { months_6: '٦ مانگ', year_1: '١ ساڵ' },
  activate: 'چالاک بکە',
  notFound: 'نەدۆزرایەوە',

  // What the message becomes once he has tapped. The buttons go with
  // it, so the same message cannot be actioned twice.
  activated: 'چالاک کرا ✓',
  markedNotFound: 'نەدۆزرایەوە',
  // He tapped a payment that /admin had already dealt with.
  alreadyHandled: 'پێشتر کرابوو',
  failed: 'سەرکەوتوو نەبوو — لە /admin هەوڵ بدەرەوە',
};

/**
 * The owner's FIB number, printed on the instructions screen for the
 * seller to transfer to. This is the whole payment integration: there
 * is no processor, no merchant account and no API call.
 */
export const FIB_NUMBER = '07515298365';

/**
 * Products a shop may publish on the free trial. Paid plans are
 * unlimited.
 *
 * app.trial_product_limit() in the database is the same number and is
 * what actually refuses the insert; scripts/plan-limits-test.mjs fails
 * if the two drift apart.
 */
/**
 * The permanent Free plan.
 *
 * Not a countdown. Every shop is on Free from the moment it exists: the
 * storefront is public, the link works, and the seller may keep this
 * many products, with this many images each. Delete one and the slot
 * comes back. Paying lifts both.
 *
 * app.free_product_limit() and app.free_image_limit() in the database
 * hold the same two numbers and are what actually refuse the write;
 * scripts/plan-limits-test.mjs fails if they drift apart.
 */
export const FREE_PRODUCT_LIMIT = 5;
export const FREE_IMAGE_LIMIT = 1;

/**
 * Kept only because the subscription screens still import them, and
 * those screens are being rewritten elsewhere. Nothing in the backend
 * reads either one: there is no trial to count days of, and the product
 * cap is FREE_PRODUCT_LIMIT above. Both go when the copy does.
 *
 * @deprecated
 */
export const TRIAL_PRODUCT_LIMIT = FREE_PRODUCT_LIMIT;
export const TRIAL_DAYS = 30;

/**
 * Renewal banners on the seller's own screens.
 *
 * The two amber ones can be closed and come back on their own; the two
 * red ones cannot be closed at all, because by then the shop is either
 * about to go dark or already has. Dismissing is always "not now",
 * never "never again" — the row only records when it was last closed.
 *
 * These belong to the seller's area and nowhere else. The public shop
 * page and the product pages never carry one: a customer arriving from
 * TikTok must not be shown a seller's billing state, and that HTML is
 * edge-cached, so it has to be identical for everybody.
 */
export const PLAN_BANNER = {
  soon: (n) => `${n} ڕۆژ لە پلانەکەت ماوە`,
  soonOne: 'سبەی پلانەکەت تەواو دەبێت',
  grace: (n) => `پلانەکەت تەواو بووە. ${n} ڕۆژ ماوە پێش ئەوەی بەرهەمەکانت بشاردرێنەوە.`,
  hidden: 'پلانی پارەدراوت تەواو بووە. بەرهەمە شاراوەکان پارێزراون؛ خۆت هەڵبژێرە کام بەرهەم ئاشکرا بێت.',
  pending: 'ناردنەکەت لە چاوەڕوانی پشتڕاستکردنەوەدایە.',
  action: 'پارەدان',
  dismiss: 'داخستن',

  /**
   * When to start warning, in days left.
   *
   * A trial is one month, so two warnings are enough. A paid plan runs
   * for six or twelve, and a seller who has not thought about it since
   * they paid needs more than three days' notice, so it gets three.
   */
  trialDays: [10, 3],
  paidDays: [14, 7, 3],

  /**
   * How long a dismissal lasts, per kind, in days. `urgent` is the last
   * threshold before the plan ends; everything earlier is `soon`.
   */
  cooldown: { soon: 3, urgent: 1 },
};

/** Advertised prices. The monthly figure is display only. */
/**
 * The two plans, and what each costs.
 *
 * `amount` is IQD and is what the seller is actually charged. It is
 * display only: app.plan_price() in the database is authoritative, the
 * browser never sends an amount, and wayl_apply_payment re-derives the
 * price before a single day is added. scripts/plan-limits-test.mjs
 * fails if these two numbers drift from the database.
 *
 * `usd` is the round number the plan is talked about in. It is never
 * charged and never sent to Wayl — the seller pays IQD, and the IQD
 * figure is on the button before they leave for Wayl.
 */
export const PLANS = [
  { key: 'year_1',   name: '١ ساڵ', amount: 72000, monthly: 6000, usd: 55, best: true  },
  { key: 'months_6', name: '٦ مانگ', amount: 38000, monthly: 6300, usd: 29, best: false },
];

/**
 * Wayl — the payment provider for subscriptions.
 *
 * The seller is sent to Wayl's own hosted checkout and picks FIB or
 * SuperQi there. Bazaro renders no payment method, no QR code, no card
 * form and no timer, and holds no credential: WAYL_API_TOKEN is a
 * Worker secret and never reaches the browser.
 *
 * The key lists exist because Wayl's exact field names are not
 * something to guess at. Each is read in order and the first present
 * one wins, so the first real payment can shorten these lists to what
 * Wayl actually sends rather than change any logic.
 */
export const WAYL = {
  apiBase: 'https://api.thewayl.com',
  currency: 'IQD',

  /**
   * Confirmed against Wayl's documentation and a real test link:
   *
   *   status         "Created" until the payment is attempted
   *   paymentMethod  null until Wayl has one to report
   *   unknown status treated as still in progress, never as a verdict
   *
   * The other three lists are still PROVISIONAL. What a completed
   * payment and a refused one actually report has not been seen yet,
   * and must not be guessed: a wrong entry here is either a plan
   * granted for nothing, or a seller told their money is gone. Only a
   * finished test payment settles them. See worker/wayl.js mapStatus.
   */
  pendingStatuses: ['created'],
  paidStatuses: ['paid', 'success', 'successful', 'completed', 'complete'],
  failedStatuses: ['failed', 'failure', 'declined', 'rejected', 'error', 'expired'],
  cancelledStatuses: ['cancelled', 'canceled'],

  /**
   * The webhook signature, per Wayl's documentation: the header
   * x-wayl-signature-256 carries an HMAC-SHA256 of the raw body, keyed
   * with the webhookSecret sent when the link was made, hex encoded.
   */
  signatureHeader: 'x-wayl-signature-256',

  /**
   * A checkout link lives an hour ("linkExpiresIn": "1h"). A seller who
   * taps Pay again inside this window is sent back to the link they
   * already have rather than being given a second one; the window is
   * deliberately well inside the hour, so a reused link is never one
   * that is about to lapse under them.
   */
  reuseMinutes: 25,

  statusKeys: ['paymentStatus', 'status', 'state', 'linkStatus'],
  referenceKeys: ['referenceId', 'reference_id', 'reference'],
  // Only a field that actually names an event. `id` was here and had to
  // go: Wayl's create and status responses both carry the LINK id under
  // `id`, so if a webhook body does the same, every delivery for one
  // payment would share a dedupe key and only the first would ever be
  // acted on. When no real event id is present, worker/routes/payment.js
  // falls back to a digest of the exact bytes, which still refuses an
  // identical replay and still lets a genuine second event through.
  eventKeys: ['eventId', 'event_id'],
  linkIdKeys: ['id', 'linkId', 'link_id'],
  codeKeys: ['code', 'linkCode', 'link_code'],
  urlKeys: ['url', 'checkoutUrl', 'checkout_url'],
  methodKeys: ['paymentMethod', 'payment_method', 'method', 'provider'],
  totalKeys: ['total', 'amount', 'totalAmount'],
  currencyKeys: ['currency'],
};

/** The number a seller reaches us on from the subscription page. */
export const SUPPORT_WHATSAPP = '+9647515298365';

/**
 * The admin screen. Not linked from anywhere in the app — a seller who
 * guesses the URL gets the same 404 as any other unknown path.
 */
export const ADMIN = {
  title: 'بەڕێوەبردن',
  overview: 'گشتی',
  shops: 'دوکانەکان',
  intents: 'داواکاری پارەدان',
  reports: 'ڕاپۆرتەکان',
  back: 'گەڕانەوە',
  all: 'هەموو',

  statShops: 'کۆی دوکانەکان',
  statActive: 'چالاک',
  statTrial: 'پلانی کۆنی بەخۆڕایی',
  statExpired: 'بەسەرچوو',
  statSuspended: 'ڕاگیراو',
  statProducts: 'کۆی بەرهەمەکان',
  statIntents: 'داواکاری کراوە',
  statReports: 'ڕاپۆرتی کراوە',

  searchLabel: 'گەڕان',
  searchPlaceholder: 'ناو، لینک یان ئیمەیڵ',
  search: 'گەڕان',

  colShop: 'دوکان',
  colCity: 'شار',
  colPlan: 'پلان',
  colStatus: 'دۆخ',
  colDays: 'ڕۆژی ماوە',
  colProducts: 'بەرهەم',
  colSignup: 'تۆمارکردن',

  statusActive: 'چالاک',
  statusTrial: 'بەخۆڕایی',
  statusExpired: 'بەسەرچوو',
  statusSuspended: 'ڕاگیراو',
  statusBanned: 'قەدەغەکراو',
  statusHidden: 'شاراوە',

  // The number is isolated LTR and the unit stays RTL beside it —
  // one string carrying both flips the two around.
  dayUnit: 'ڕۆژ',
  dayUnitOver: 'ڕۆژ بەسەرچووە',

  shopsEmpty: 'هیچ دوکانێک نەدۆزرایەوە.',

  intentsTitle: 'پارەدانەکان',
  intentsEmpty: 'هیچ داواکارییەکی کراوە نییە.',
  intentShop: 'دوکان',
  intentPlan: 'پلان',
  intentAmount: 'بڕ',
  intentReference: 'کۆدی ئاماژە',
  intentDate: 'بەروار',
  intentWhatsapp: 'واتساپ',
  intentActivate: 'چالاککردن',
  intentConfirm: 'دڵنیایت؟ پلانەکە چالاک دەکرێت و بەرهەمەکان دەردەکەون.',
  intentDone: 'پلانەکە چالاک کرا.',
  intentFailed: 'چالاککردن سەرکەوتوو نەبوو.',
  // Not a rejection: the intent goes back to where it was and the owner
  // follows it up on WhatsApp himself.
  intentNotFound: 'نەدۆزرایەوە',
  intentNotFoundConfirm:
    'پارەکە نەدۆزرایەوە؟ داواکارییەکە دەگەڕێتەوە دۆخی پێشوو و هیچ پلانێک چالاک ناکرێت.',
  intentPendingBadge: 'ناردراوە',
  intentOpenBadge: 'کراوە',

  expiringTitle: 'بەم زووانە تەواو دەبن',
  expiringEmpty: 'هیچ دوکانێک لەم ٧ ڕۆژەدا تەواو نابێت.',
  expiringDays: (n) => `${n} ڕۆژ`,
  expiringGrace: 'لە ماوەی مۆڵەتدایە',
  expiringWhatsapp: 'واتساپ',

  detailTitle: 'دوکان',
  owner: 'خاوەن',
  signedUp: 'تۆمارکراوە',
  viewShop: 'بینینی دوکان',
  suspend: 'ڕاگرتنی دوکان',
  unsuspend: 'کردنەوەی دوکان',
  suspendConfirm: 'دڵنیایت؟ دوکانەکە بۆ گشت پەڕەکان دەشاردرێتەوە.',
  expiryTitle: 'بەرواری کۆتایی',
  expiryLabel: 'بەرواری نوێ',
  expirySave: 'پاشەکەوتکردن',
  expiryHint: 'دەستکاری بە دەست. لە audit_log تۆمار دەکرێت.',
  notesTitle: 'تێبینی',
  notesPlaceholder: 'تێبینی ناوخۆیی. فرۆشیار نایبینێت.',
  notesSave: 'پاشەکەوتکردن',
  productsTitle: 'بەرهەمەکان',
  productsEmpty: 'هیچ بەرهەمێک نییە.',
  saved: 'پاشەکەوت کرا',

  reportsTitle: 'ڕاپۆرتەکان',
  reportsEmpty: 'هیچ ڕاپۆرتێکی کراوە نییە.',
  reportReason: 'هۆکار',
  reportTarget: 'ڕاپۆرتکراو',
  reportHide: 'شاردنەوەی بەرهەم',
  reportDismiss: 'پشتگوێخستن',
  reportHideConfirm: 'بەرهەمەکە بشاردرێتەوە؟',
};

/** Report reasons, as the queue shows them. */
export const REPORT_REASONS = {
  fake: 'ساختە',
  scam: 'فێڵ',
  offensive: 'ناشیرین',
  stolen_photos: 'وێنەی دزراو',
  wrong_price: 'نرخی هەڵە',
  other: 'ئەوانی تر',
};

/** Plan keys as they appear in the database. */
export const PLAN_LABEL = {
  none: 'بێ پلان',
  trial: 'بەخۆڕایی',
  // Never sold. The owner grants it by hand from /admin.
  month_1: '١ مانگ',
  months_6: '٦ مانگ',
  year_1: '١ ساڵ',
};

/** Plans an admin may grant. month_1 is grant-only and has no price. */
export const GRANT_PLANS = ['month_1', 'months_6', 'year_1'];


/** /search — the shared search screen. */
export const SEARCH = {
  title: 'گەڕان',
  placeholder: 'گەڕان بۆ کاڵا یان دوکان',
  tabProducts: 'کاڵاکان',
  tabShops: 'دوکانەکان',
  clear: 'سڕینەوە',

  // "3 ئەنجام" — the count is isolated LTR beside the word.
  resultUnit: 'ئەنجام',
  productsOf: (n) => `${n} کاڵا`,

  emptyTitle: 'هیچ شتێک نەدۆزرایەوە',
  emptyBody: 'هەڵەیەکی نووسین؟ یان جۆرێک تاقی بکەرەوە:',
  startTitle: 'چی دەگەڕێیت بەدوایدا؟',
  startBody: 'ناوی کاڵا، یان ناوی دوکانێک بنووسە. یان جۆرێک هەڵبژێرە:',
  noShops: 'هیچ دوکانێک نەدۆزرایەوە بەم ناوە.',
  seeShop: 'بینینی دوکان',
};

/** /saved — the hearts. */
export const SAVED = {
  title: 'پاشەکەوتکراوەکان',
  tab: 'پاشەکەوت',
  emptyTitle: 'هێشتا هیچت پاشەکەوت نەکردووە',
  emptyBody: 'دڵەکە لەسەر هەر کاڵایەک دابگرە بۆ ئەوەی لێرە بمێنێتەوە.',
  browse: 'بڕوانە بۆ تۆ',
  signedOutNote: 'ئەمانە تەنها لەسەر ئەم مۆبایلە پاشەکەوت کراون. بچۆ ژوورەوە بۆ ئەوەی لەدەست نەچن.',
  signIn: 'چوونە ژوورەوە',
  remove: 'لابردن',
  loading: 'چاوەڕێ بکە…',
};

/** Profile image variants. One size each — a banner needs no thumbnail. */
export const PROFILE_VARIANTS = {
  banner: { width: 1200, height: 450, quality: 0.8,  ratio: 450 / 1200 },
  logo:   { width: 400,  height: 400, quality: 0.85, ratio: 1 },
};
