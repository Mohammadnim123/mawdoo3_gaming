/** E33 — framework-free i18n core (locale resolution, catalogs, formatting). */

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_S,
  LocaleController,
  CookieLocaleStorage,
  createLocaleController,
  isLocale,
  parseLocaleCookie,
  type Direction,
  type Locale,
  type LocaleStorage,
} from "./locale";

export {
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
  intlLocale,
  type DurationLabels,
  type MessageParams,
  type PluralMessage,
  type RelativeTimeLabels,
} from "./format";

export { MESSAGES, messagesFor, type Messages } from "./messages";

export { creditKindLabel, genreLabel, planFeatureLabel, stepLabel } from "./catalogLabels";
