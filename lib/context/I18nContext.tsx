"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

export type Locale = "en" | "fr" | "ar";

export type TranslateParams = Record<string, string | number>;

export type TranslateFn = (key: string, params?: TranslateParams) => string;

const STORAGE_KEY = "axira-locale";
const COOKIE_NAME = "AXIRA_LOCALE";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const catalogs = { en, fr, ar } as const;

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc != null && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`
  );
}

function isLocale(s: string | null): s is Locale {
  return s === "en" || s === "fr" || s === "ar";
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (isLocale(fromStorage)) return fromStorage;
  } catch {
    /* ignore */
  }
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const raw = m?.[1] ? decodeURIComponent(m[1]) : null;
  if (isLocale(raw)) return raw;
  return "en";
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function makeT(locale: Locale): TranslateFn {
  return (key, params) => {
    const messages = catalogs[locale] as Record<string, unknown>;
    let lookupKey = key;
    if (params && "count" in params) {
      const n = Number(params.count);
      if (n !== 1) {
        const pluralPath = `${key}_plural`;
        const pluralVal = getByPath(messages, pluralPath);
        if (typeof pluralVal === "string") lookupKey = pluralPath;
      }
    }
    let value = getByPath(messages, lookupKey);
    if (typeof value !== "string") value = getByPath(messages, key);
    if (typeof value !== "string") {
      value = getByPath(catalogs.en as Record<string, unknown>, key);
    }
    if (typeof value !== "string") return key;
    return interpolate(value, params);
  };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial = readStoredLocale();
    setLocaleState(initial);
    setMounted(true);
    if (typeof document !== "undefined") {
      document.documentElement.lang = initial;
      document.documentElement.dir = initial === "ar" ? "rtl" : "ltr";
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(next)};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
      document.documentElement.lang = next;
      document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale, mounted]);

  const t = useMemo(() => makeT(locale), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useT(): TranslateFn {
  return useI18n().t;
}

export function formatDateForLocale(
  locale: Locale,
  input: string | number | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const loc = locale === "ar" ? "ar" : locale === "fr" ? "fr" : "en";
  // `dateStyle` / `timeStyle` cannot be combined with granular fields (day, month, year, hour, …).
  const hasOpts = options != null && Object.keys(options).length > 0;
  const fmtOptions: Intl.DateTimeFormatOptions = hasOpts ? { ...options } : { dateStyle: "short" };
  return new Intl.DateTimeFormat(loc, fmtOptions).format(d);
}

export function formatNumberForLocale(locale: Locale, n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : locale === "fr" ? "fr-FR" : "en-US", options).format(
    n
  );
}
