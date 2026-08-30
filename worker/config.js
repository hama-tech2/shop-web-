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
  onlyTen: 'تەنها ١٠ وێنە هەتایە.',

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

export const MAX_IMAGES = 10;
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

  errName: 'ناوی دوکان دەبێت لانیکەم ٢ پیت بێت.',
  errWhatsapp: 'ژمارەی واتساپ بەم شێوەیە بنووسە: 07501234567',
  errPhone: 'ژمارەی تەلەفۆن دروست نییە.',
  errHandle: 'تەنها پیت، ژمارە، . و _ بەکاربهێنە.',
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
  productCategory: 'جۆری دوکانەکەت',
  none: 'هیچ',
};

export const MAX_CATEGORIES = 20;

export const SUBSCRIPTION = {
  title: 'پلانی بەشداریکردن',
  daysLeft: (n) => `تەنها ${n} ڕۆژ لە مانگی بەخۆڕایی ماوە`,
  daysLeftOne: 'ڕۆژی کۆتایی مانگی بەخۆڕاییە',
  expired: 'مانگی بەخۆڕایی تەواو بووە',
  inGrace: (n) => `${n} ڕۆژ ماوە پێش ئەوەی بەرهەمەکانت بشاردرێنەوە`,
  activeUntil: (d) => `چالاکە تا ${d}`,

  best: 'باشترین نرخ',
  perMonth: (n) => `${n} مانگانە`,
  yearName: '١ ساڵ',
  sixName: '٦ مانگ',
  savings: 'لە بەرامبەر ٦ مانگ پاشەکەوت دەکەیت',

  whatYouGet: 'چی وەردەگریت',
  benefits: [
    'تا ١٠٠٠ بەرهەم بەبێ سنوور',
    'بەستەری تایبەت بۆ دوکانەکەت',
    'دەرکەوتن لە بەشی بۆ تۆ',
    'پشتگیری خێرا',
  ],

  offer: 'لە مانگی بەخۆڕاییدا پارە بدە و ٢ مانگی زیادە بەخۆڕایی وەربگرە',
  pay: 'پارەدان',
  payVia: 'پارەدان لە ڕێگەی FIB',
  startFree: 'مانگی بەخۆڕاییەکەت بەکاربهێنە',

  requestedTitle: 'داواکەت تۆمار کرا',
  requestedBody: 'هێشتا پارەدانی ئۆتۆماتیکی نییە. تیمەکەمان لە ڕێگەی واتساپەوە پەیوەندیت پێوە دەکات بۆ تەواوکردنی پارەدان.',
  requestedPlan: 'پلانی هەڵبژێردراو',
  contactUs: 'پەیوەندیمان پێوە بکە',
  backToPlans: 'گەڕانەوە بۆ پلانەکان',
};

/** Advertised prices. The monthly figure is display only. */
export const PLANS = [
  { key: 'year_1',   name: '١ ساڵ', amount: 90000, monthly: 7500, best: true  },
  { key: 'months_6', name: '٦ مانگ', amount: 55000, monthly: 9200, best: false },
];

/** The number a seller reaches us on from the subscription page. */
export const SUPPORT_WHATSAPP = '+9647500000000';

/** Profile image variants. One size each — a banner needs no thumbnail. */
export const PROFILE_VARIANTS = {
  banner: { width: 1200, height: 450, quality: 0.8,  ratio: 450 / 1200 },
  logo:   { width: 400,  height: 400, quality: 0.85, ratio: 1 },
};
