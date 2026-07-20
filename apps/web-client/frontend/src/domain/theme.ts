/**
 * E32 theming domain — framework-free, fully unit-testable.
 *
 * The user preference is three-valued: explicit `light`/`dark`, or `auto`
 * (the default) which follows the LOCAL TIME OF DAY — light through the day,
 * dark through the evening/night. The resolved theme is applied as
 * `data-theme` on <html>; the palettes live in @codply/ui styles.css.
 *
 * Keep `ThemeScript` (the pre-paint boot script) in sync with this module —
 * its source is generated from the constants below, and theme.test.ts pins
 * the resolution rules both share.
 */

export type ThemePreference = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "fp-theme";
/** Auto mode: light from 07:00, dark from 19:00 (device-local time). */
export const LIGHT_START_HOUR = 7;
export const DARK_START_HOUR = 19;

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "auto", "dark"];

/** Storage seam — localStorage in the app, an in-memory map in tests. */
export interface PreferenceStore {
  read(): string | null;
  write(value: string): void;
}

/** localStorage-backed store; every access is try/caught (Safari private
 * mode, blocked storage, SSR) — a failing store degrades to `auto`. */
export class LocalStoragePreferenceStore implements PreferenceStore {
  constructor(private readonly key: string = THEME_STORAGE_KEY) {}

  read(): string | null {
    try {
      return window.localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  write(value: string): void {
    try {
      window.localStorage.setItem(this.key, value);
    } catch {
      // Preference simply won't persist — resolution still works.
    }
  }
}

export class MemoryPreferenceStore implements PreferenceStore {
  private value: string | null = null;

  read(): string | null {
    return this.value;
  }

  write(value: string): void {
    this.value = value;
  }
}

export class ThemeController {
  constructor(
    private readonly store: PreferenceStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Sanitized stored preference — anything unexpected reads as `auto`. */
  preference(): ThemePreference {
    const raw = this.store.read();
    return raw === "light" || raw === "dark" ? raw : "auto";
  }

  setPreference(preference: ThemePreference): void {
    this.store.write(preference);
  }

  /** The theme to render right now for a preference. */
  resolve(preference: ThemePreference = this.preference()): ResolvedTheme {
    return preference === "auto" ? ThemeController.resolveAuto(this.now()) : preference;
  }

  /** Auto rule shared with the boot script: day = light, night = dark. */
  static resolveAuto(date: Date): ResolvedTheme {
    const hour = date.getHours();
    return hour >= LIGHT_START_HOUR && hour < DARK_START_HOUR ? "light" : "dark";
  }

  /**
   * Milliseconds until the auto theme next changes (07:00 or 19:00 local) —
   * lets the provider schedule the flip instead of polling. Clamped to ≥1s
   * so a boundary-exact call can never busy-loop.
   */
  msUntilNextFlip(date: Date = this.now()): number {
    const hour = date.getHours();
    const targetHour =
      hour < LIGHT_START_HOUR
        ? LIGHT_START_HOUR
        : hour < DARK_START_HOUR
          ? DARK_START_HOUR
          : LIGHT_START_HOUR + 24;
    const next = new Date(date);
    next.setHours(targetHour, 0, 0, 0);
    return Math.max(1_000, next.getTime() - date.getTime());
  }
}

/** Stamp the resolved theme on the document root (attribute drives the CSS
 * palette; color-scheme keeps native scrollbars/controls in step). */
export function applyResolvedTheme(theme: ResolvedTheme, root: HTMLElement): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
