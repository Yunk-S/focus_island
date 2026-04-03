import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import zh from './messages/zh';
import en from './messages/en';

const STORAGE_KEY = 'focus_island_locale';

const MESSAGES = { zh, en };

function getNested(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'zh';
    } catch {
      return 'zh';
    }
  });

  const dict = MESSAGES[locale] || MESSAGES.zh;

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback((next) => {
    if (next !== 'zh' && next !== 'en') return;
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key, params) => {
      let s = getNested(dict, key);
      if (s === undefined) s = getNested(MESSAGES.zh, key);
      if (s === undefined) return key;
      if (typeof s !== 'string') return key;
      if (params && typeof params === 'object') {
        Object.entries(params).forEach(([k, v]) => {
          s = s.replaceAll(`{${k}}`, String(v));
        });
      }
      return s;
    },
    [dict]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
