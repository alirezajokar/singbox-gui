// Tiny i18n: Persian (default) and English. Keys live in locales.js.

import { fa, en } from './locales.js';

const dictionaries = { fa, en };
let lang = 'fa';

export function setLang(next) {
  lang = dictionaries[next] ? next : 'fa';
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }
  return lang;
}

export function getLang() {
  return lang;
}

/** t('key', { n: 3 })  — {n} placeholders; falls back to English, then the key. */
export function t(key, vars) {
  let s = dictionaries[lang][key];
  if (s === undefined) s = en[key];
  if (s === undefined) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : isolate(vars[k])));
  return s;
}

// In Persian text, Latin values (paths, tags, hosts) are wrapped in a left-to-right
// isolate so punctuation such as the leading "/" of a path stays where it belongs.
const LRI = '\u2066';
const PDI = '\u2069';
function isolate(v) {
  const str = String(v);
  return lang === 'fa' && typeof v === 'string' && /[A-Za-z/]/.test(str) ? `${LRI}${str}${PDI}` : str;
}
