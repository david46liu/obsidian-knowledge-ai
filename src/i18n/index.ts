import en from './locales/en';
import zhCN from './locales/zh-CN';

export type Locale = 'en' | 'zh-CN';

const DICTS: Record<Locale, Record<string, string>> = {
  'en': en,
  'zh-CN': zhCN,
};

let current: Locale = 'en';

/** Set the active UI locale. Persisted by the caller. */
export function setLocale(locale: Locale): void {
  if (DICTS[locale]) current = locale;
}

export function getLocale(): Locale {
  return current;
}

/**
 * Resolve which locale to use by default.
 *   1) Persisted plugin setting (if provided).
 *   2) Obsidian's `moment.locale()` if available.
 *   3) Browser navigator.language.
 *   4) Fallback to 'en'.
 *
 * Anything that starts with `zh` resolves to `zh-CN` because we only ship one
 * Chinese variant for now.
 */
export function resolveDefaultLocale(persisted?: Locale | null): Locale {
  if (persisted && DICTS[persisted]) return persisted;
  const candidates: string[] = [];
  try {
    const w: unknown = globalThis;
    const moment = (w as { moment?: { locale?: () => string } }).moment;
    if (moment?.locale) candidates.push(moment.locale());
  } catch { /* ignore */ }
  if (typeof navigator !== 'undefined' && navigator.language) {
    candidates.push(navigator.language);
  }
  for (const c of candidates) {
    const lower = c.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

/**
 * Translate `key` into the active locale. Falls back to English, then to the
 * raw key if no translation exists. Supports `{name}` style interpolation.
 *
 * Example:
 *   t('common.cancel') → "Cancel"
 *   t('notebook.progress', { done: 3, total: 10 }) → "3 / 10 indexed"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[current] ?? DICTS.en;
  let s = dict[key];
  if (s === undefined) s = DICTS.en[key];
  if (s === undefined) s = key;
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.split(`{${k}}`).join(String(params[k]));
    }
  }
  return s;
}

/** List of available locales for the language picker UI. */
export const AVAILABLE_LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];
