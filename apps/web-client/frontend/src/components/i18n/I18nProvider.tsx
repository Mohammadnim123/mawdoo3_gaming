"use client";

import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  createLocaleController,
  isLocale,
  formatCountdown,
  formatDateTime,
  formatDayLabel,
  formatElapsedSeconds,
  formatFullDate,
  formatMessage,
  formatMonthYear,
  formatNumber,
  formatPlural,
  formatShortDate,
  formatTimeAgo,
  formatUntil,
  messagesFor,
  type Direction,
  type Locale,
  type MessageParams,
  type Messages,
  type PluralMessage,
} from "@/domain/i18n";

/** Locale-bound formatting helpers — one object per provider render. */
export interface I18nFormatters {
  /** `{param}` interpolation on a plain catalog string. */
  msg: (template: string, params?: MessageParams) => string;
  /** CLDR plural selection + interpolation (`{count}` always available). */
  plural: (message: PluralMessage, count: number, params?: MessageParams) => string;
  number: (value: number) => string;
  /** "now" / "5m" / "2h" compact relative time (short date fallback). */
  timeAgo: (iso: string, now?: Date) => string;
  shortDate: (iso: string) => string;
  monthYear: (iso: string) => string;
  dateTime: (iso: string) => string;
  fullDate: (iso: string) => string;
  /** Weekday + short date for thread day dividers ("Mon, Jul 7"). */
  dayLabel: (year: number, month: number, day: number) => string;
  /** "4h 12m" until an ISO instant. */
  until: (iso: string, now?: Date) => string;
  /** "4h 12m" for a millisecond delta. */
  countdown: (ms: number) => string;
  /** "1m 05s" elapsed-build clock. */
  elapsed: (seconds: number) => string;
}

export interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  /** The typed catalog — `t.nav.logIn`, `t.feed.trending`, … */
  t: Messages;
  f: I18nFormatters;
  /** Navigate to `?lang=xx` — Django persists the fp_locale cookie and re-renders. */
  setLocale: (locale: Locale) => void;
}

/**
 * Active locale — Django renders `<html lang="en|ar" dir>`, so the document
 * element is the source of truth in the islands build (fallback "en").
 */
export function resolveDocumentLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const lang = document.documentElement.lang?.toLowerCase().split("-")[0];
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

function buildValue(locale: Locale): I18nContextValue {
  const controller = createLocaleController();
  const t = messagesFor(locale);
  const f: I18nFormatters = {
    msg: (template, params) => formatMessage(template, params),
    plural: (message, count, params) => formatPlural(locale, message, count, params),
    number: (value) => formatNumber(locale, value),
    timeAgo: (iso, now) => formatTimeAgo(locale, t.time, iso, now),
    shortDate: (iso) => formatShortDate(locale, iso),
    monthYear: (iso) => formatMonthYear(locale, iso),
    dateTime: (iso) => formatDateTime(locale, iso),
    fullDate: (iso) => formatFullDate(locale, iso),
    dayLabel: (year, month, day) => formatDayLabel(locale, year, month, day),
    until: (iso, now) => formatUntil(t.time, iso, now),
    countdown: (ms) => formatCountdown(t.time, ms),
    elapsed: (seconds) => formatElapsedSeconds(t.time, seconds),
  };
  return {
    locale,
    dir: controller.direction(locale),
    t,
    f,
    setLocale: (next) => {
      if (next === locale) return;
      // Full navigation to `?lang=xx` on the current path: Django sets the
      // fp_locale cookie and re-renders <html lang dir> atomically — zero
      // mixed-direction flash.
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.location.assign(url);
    },
  };
}

/**
 * Default = English so isolated component tests (and any stray tree without
 * a provider) still render — the app always mounts a provider in Providers.
 */
const I18nContext = createContext<I18nContextValue | null>(null);
let fallbackValue: I18nContextValue | null = null;

export function I18nProvider({
  locale,
  children,
}: {
  /** Active locale; defaults to `<html lang>` (Django-rendered) when omitted. */
  locale?: Locale;
  children: ReactNode;
}): ReactElement {
  const value = useMemo(() => buildValue(locale ?? resolveDocumentLocale()), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Typed catalog + formatter access — `const { t, f } = useI18n()`. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  fallbackValue ??= buildValue(DEFAULT_LOCALE);
  return fallbackValue;
}
