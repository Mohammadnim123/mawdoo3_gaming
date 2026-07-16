/**
 * E33 — tiny formatting helpers for the typed catalogs (framework-free).
 *
 * Digit policy (documented in docs/epics/E33_arabic_rtl.md): Arabic uses
 * LATIN (Western) digits — `ar-u-nu-latn` — so credits, counts, versions and
 * code stay visually consistent with the LTR islands (code panes, URLs, ids).
 */

import type { Locale } from "./locale";

/** BCP-47 tag handed to every Intl API. */
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : "en";
}

export type MessageParams = Record<string, string | number>;

/** `{param}` interpolation. Unknown placeholders are left as-is. */
export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Plural leaf: `other` is the required fallback; the remaining CLDR
 * categories are optional so English carries {one, other} while Arabic can
 * carry the full {zero, one, two, few, many, other} set.
 */
export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(intlLocale(locale));
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/**
 * Select + interpolate a plural form. `{count}` is always available as a
 * parameter; extra params merge in.
 */
export function formatPlural(
  locale: Locale,
  message: PluralMessage,
  count: number,
  params?: MessageParams,
): string {
  const category = pluralRules(locale).select(count);
  const template = message[category] ?? message.other;
  return formatMessage(template, { count, ...params });
}

/** Locale-aware integer/decimal formatting (Latin digits under `ar`). */
export function formatNumber(locale: Locale, value: number): string {
  return value.toLocaleString(intlLocale(locale));
}

/** Short month + numeric day, e.g. "Jul 7" / "٧ يوليو" (latn digits: "7 يوليو"). */
export function formatShortDate(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(intlLocale(locale), { month: "short", day: "numeric" });
}

/** Month + year, e.g. "Jul 2026" (profile "Joined" line). */
export function formatMonthYear(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(intlLocale(locale), { month: "short", year: "numeric" });
}

/** Compact date-time for ledgers/versions, e.g. "Jul 7, 4:12 PM". */
export function formatDateTime(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(intlLocale(locale), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Weekday + short date for the thread's day dividers ("Mon, Jul 7"). */
export function formatDayLabel(locale: Locale, year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toLocaleDateString(intlLocale(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Full locale date (comment fallback timestamps). */
export function formatFullDate(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(intlLocale(locale));
}

/** Labels the compact relative-time formatter needs from the catalog. */
export interface RelativeTimeLabels {
  readonly now: string;
  /** Templates with `{count}` — "{count}m" / "{count}د". */
  readonly minutes: string;
  readonly hours: string;
  readonly days: string;
  readonly weeks: string;
}

/**
 * Compact relative timestamps for the social feed: "now", "5m", "2h", "3d",
 * "2w", then a short locale date — FB-style, no ticking re-renders needed.
 */
export function formatTimeAgo(
  locale: Locale,
  labels: RelativeTimeLabels,
  iso: string,
  now: Date = new Date(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return labels.now;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatMessage(labels.minutes, { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatMessage(labels.hours, { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return formatMessage(labels.days, { count: days });
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return formatMessage(labels.weeks, { count: weeks });
  return formatShortDate(locale, iso);
}

/** Labels for countdown durations ("4h 12m" / "4س 12د"). */
export interface DurationLabels {
  /** "{count}h"-style templates. */
  readonly hoursShort: string;
  readonly minutesShort: string;
  readonly secondsShort: string;
  /** "<1m" equivalent. */
  readonly underAMinute: string;
}

/** "4h 12m" / "12m" / "<1m" until `iso` (claim resets, quota rollovers). */
export function formatUntil(
  labels: DurationLabels,
  iso: string,
  now: Date = new Date(),
): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  return formatCountdown(labels, target - now.getTime());
}

/** Same as formatUntil for a raw millisecond delta. */
export function formatCountdown(labels: DurationLabels, ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return labels.underAMinute;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const m = formatMessage(labels.minutesShort, { count: minutes });
  return hours > 0 ? `${formatMessage(labels.hoursShort, { count: hours })} ${m}` : m;
}

/** "1m 05s" / "42s" elapsed-build clock. */
export function formatElapsedSeconds(labels: DurationLabels, seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const sLabel = formatMessage(labels.secondsShort, {
    count: m > 0 ? String(s).padStart(2, "0") : s,
  });
  return m > 0 ? `${formatMessage(labels.minutesShort, { count: m })} ${sLabel}` : sLabel;
}
