/**
 * Shop Web — app-wide config.
 *
 * APP_NAME is the placeholder brand. It appears in the header, the page
 * title and the OG tags — change it HERE and nowhere else.
 */
export const APP_NAME = 'بازاڕ';

export const APP_TAGLINE = 'بازاڕی هەولێر';

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
  currency: 'IQD',
  language: 'زمان',
  soon: 'بەم زووانە',
  save: 'پاشەکەوتکردن',
  tabFeed: 'بۆ تۆ',
  tabAccount: 'هەژمارم',
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
  errUpload: 'ناردنی وێنە سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.',
  errType: 'تەنها JPG، PNG یان WebP.',
  errSave: 'پاشەکەوتکردن سەرکەوتوو نەبوو.',
  // Nothing was changed: the row is gone, or it was never this
  // seller's to change. Both must say so instead of claiming success.
  errGone: 'ئەم بەرهەمە نەدۆزرایەوە. لەوانەیە پێشتر سڕابێتەوە.',

  // The trial limit. A refusal on its own leaves the seller stuck, so
  // the message says what to do next and the screen carries the link.
  trialLimitTitle: 'سنووری مانگی بەخۆڕایی',
  trialLimitBody: (max) =>
    `لە مانگی بەخۆڕاییدا تا ${max} بەرهەم دەتوانیت بڵاو بکەیتەوە. ` +
    'بۆ بەرهەمی زیاتر پلانێک هەڵبژێرە — بەرهەمە ئێستاکانت وەک خۆیان دەمێننەوە.',
  trialLimitAction: 'بینینی پلانەکان',
  trialLeft: (n, max) => `${n} لە ${max} شوێنی ماوە لە مانگی بەخۆڕایی`,

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
  stateTrial: (n) => `مانگی بەخۆڕایی — ${n} ڕۆژ ماوە`,
  stateTrialLast: 'ڕۆژی کۆتایی مانگی بەخۆڕاییە',
  statePending: 'چاوەڕوانی پشتڕاستکردنەوە',
  stateActive: (d) => `چالاکە تا ${d}`,
  stateGrace: (n) => `بەسەرچووە — ${n} ڕۆژ ماوە پێش شاردنەوەی بەرهەمەکان`,
  stateExpired: 'بەرهەمەکانت شاراونەتەوە. بۆ گەڕاندنەوەیان پارە بدە.',

  best: 'باشترین نرخ',
  perMonth: (n) => `${n} مانگانە`,
  savings: 'لە بەرامبەر ٦ مانگ پاشەکەوت دەکەیت',

  // The free month, named at the bottom of the plans, small. It is
  // what a seller is already on, not something to sell them.
  freeTitle: 'مانگی بەخۆڕایی',
  freeBody: (n) => `تا ${n} بەرهەم، بۆ یەک مانگ.`,

  whatYouGet: 'چی وەردەگریت',
  benefits: [
    'تا ١٠٠٠ بەرهەم بەبێ سنوور',
    'بەستەری تایبەت بۆ دوکانەکەت',
    'دەرکەوتن لە بەشی بۆ تۆ',
    'پشتگیری خێرا',
  ],

  pay: 'پارەدان',
  payVia: 'پارەدان لە ڕێگەی FIB',

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
export const TRIAL_PRODUCT_LIMIT = 5;

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
  hidden: 'بەرهەمەکانت شاراونەتەوە. پارە بدە بۆ ئەوەی یەکسەر بگەڕێنەوە.',
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
export const PLANS = [
  { key: 'year_1',   name: '١ ساڵ', amount: 90000, monthly: 7500, best: true  },
  { key: 'months_6', name: '٦ مانگ', amount: 55000, monthly: 9200, best: false },
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
   * PROVISIONAL, and the reason the manual test on a real phone comes
   * before this flow is switched on. Anything not on one of these
   * lists is treated as still in progress — never as paid, never as
   * failed. See worker/wayl.js mapStatus.
   *
   * One real value has been seen so far: a freshly created test link
   * reports status "Created" with paymentMethod null. That is on none
   * of these lists, and reads as still in progress, which is right.
   * What a completed and a refused payment report is still unknown and
   * must not be guessed: a wrong entry here is either a plan granted
   * for nothing or a seller told their money is gone.
   */
  paidStatuses: ['paid', 'success', 'successful', 'completed', 'complete'],
  failedStatuses: ['failed', 'failure', 'declined', 'rejected', 'error', 'expired'],
  cancelledStatuses: ['cancelled', 'canceled'],

  statusKeys: ['paymentStatus', 'status', 'state', 'linkStatus'],
  referenceKeys: ['referenceId', 'reference_id', 'reference'],
  eventKeys: ['eventId', 'event_id', 'id'],
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
  statTrial: 'لە مانگی بەخۆڕایی',
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
  trial: 'بەخۆڕایی',
  months_6: '٦ مانگ',
  year_1: '١ ساڵ',
};


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
