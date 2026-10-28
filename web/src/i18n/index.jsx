import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.js';
import fr from './fr.js';

const KEY = 'memento.lang';
export const DICTIONARIES = { fr, en };

export function storedLanguage() {
  try {
    const value = localStorage.getItem(KEY);
    return value in DICTIONARIES ? value : null;
  } catch {
    return null;
  }
}

export function detectLanguage() {
  const stored = storedLanguage();
  if (stored) return stored;
  const preferred = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return preferred.some((tag) => /^fr\b/i.test(tag ?? '')) ? 'fr' : 'en';
}

// Values are strings, arrays, or functions of the call's extra arguments (plurals, interpolation).
function translator(lang) {
  const dict = DICTIONARIES[lang] ?? en;
  return (key, ...args) => {
    const value = dict[key] ?? en[key];
    if (value === undefined) return key;
    return typeof value === 'function' ? value(...args) : value;
  };
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(detectLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(
    () => ({
      lang,
      t: translator(lang),
      setLang: (next) => {
        try {
          localStorage.setItem(KEY, next);
        } catch {
          /* storage unavailable: the choice lasts for this page only */
        }
        setLang(next);
      },
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Screens rendered without a provider (unit tests) still resolve the stored or browser language.
export function useI18n() {
  const context = useContext(I18nContext);
  if (context) return context;
  const lang = detectLanguage();
  return { lang, t: translator(lang), setLang: () => {} };
}

export const useT = () => useI18n().t;
