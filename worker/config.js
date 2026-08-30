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
