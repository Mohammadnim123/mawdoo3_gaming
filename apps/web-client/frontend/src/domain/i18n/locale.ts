/**
 * E33 — locale resolution & persistence (framework-free core).
 *
 * The active locale is resolved in strict priority order:
 *   1. stored preference (the `fp_locale` cookie),
 *   2. browser language (`navigator.languages`),
 *   3. DEFAULT_LOCALE ("en").
 *
 * Persistence is a COOKIE (not localStorage) by contract: the server layout
 * must know the locale at render time so `<html lang dir>` is correct with
 * zero flash of the wrong direction.
 */

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type Direction = "ltr" | "rtl";

/** Cookie contract (CONVENTIONS §11): name, 1-year lifetime, SameSite=Lax. */
export const LOCALE_COOKIE = "fp_locale";
export const LOCALE_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/** Narrowing guard for anything claiming to be a Locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Storage port — the controller never touches `document.cookie` directly so
 * it stays unit-testable and environment-agnostic (client cookie adapter in
 * the browser, a fake in tests, `next/headers` on the server side).
 */
export interface LocaleStorage {
  /** Raw stored preference, or null when nothing (valid) is stored. */
  get(): string | null;
  set(locale: Locale): void;
}

/** Browser-cookie adapter for the storage port. */
export class CookieLocaleStorage implements LocaleStorage {
  get(): string | null {
    if (typeof document === "undefined") return null;
    return parseLocaleCookie(document.cookie);
  }

  set(locale: Locale): void {
    if (typeof document === "undefined") return;
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_S}; samesite=lax`;
  }
}

/** Pure `Cookie:`-header / document.cookie parser for the locale value. */
export function parseLocaleCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOCALE_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * OOP core of E33: resolves, persists and describes locales. Construct with
 * a storage port; screens use it through the React glue (I18nProvider).
 */
export class LocaleController {
  constructor(private readonly storage: LocaleStorage) {}

  /**
   * Active locale: stored preference → browser language → DEFAULT_LOCALE.
   * `browserLanguages` defaults to `navigator.languages` when available.
   */
  resolve(browserLanguages?: readonly string[]): Locale {
    const stored = this.storage.get();
    if (isLocale(stored)) return stored;

    const languages =
      browserLanguages ??
      (typeof navigator !== "undefined"
        ? (navigator.languages ?? [navigator.language])
        : []);
    for (const language of languages) {
      const base = language?.toLowerCase().split("-")[0];
      if (isLocale(base)) return base;
    }
    return DEFAULT_LOCALE;
  }

  /** Persist the preference (cookie — readable by the server layout). */
  persist(locale: Locale): void {
    this.storage.set(locale);
  }

  /** Layout direction for a locale. */
  direction(locale: Locale): Direction {
    return locale === "ar" ? "rtl" : "ltr";
  }
}

/** Default browser-backed controller (the app's singleton seam). */
export function createLocaleController(): LocaleController {
  return new LocaleController(new CookieLocaleStorage());
}
