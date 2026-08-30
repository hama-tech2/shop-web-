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
