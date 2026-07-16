"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  LocalStoragePreferenceStore,
  THEME_STORAGE_KEY,
  ThemeController,
  applyResolvedTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/domain/theme";

interface ThemeContextValue {
  /** The stored three-valued preference (light | auto | dark). */
  preference: ThemePreference;
  /** What is on screen right now. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Keep the mobile browser chrome (address bar) on the canvas color. */
function syncThemeColorMeta(): void {
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-canvas")
    .trim();
  if (!canvas) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = canvas;
}

/**
 * Owns the theme lifecycle after the ThemeScript boot: applies preference
 * changes, schedules the auto flip at the next 07:00/19:00 boundary, and
 * follows changes made in other tabs. SSR renders the dark default; the
 * boot script has already corrected <html> before hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [controller] = useState(() => new ThemeController(new LocalStoragePreferenceStore()));
  const [preference, setPreferenceState] = useState<ThemePreference>("auto");
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  // Adopt the real client state on mount (localStorage is client-only).
  useEffect(() => {
    setPreferenceState(controller.preference());
    setResolved(controller.resolve());
  }, [controller]);

  useEffect(() => {
    applyResolvedTheme(resolved, document.documentElement);
    syncThemeColorMeta();
  }, [resolved]);

  // Auto mode: flip exactly at the next boundary, then re-arm.
  useEffect(() => {
    if (preference !== "auto") return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      timer = setTimeout(() => {
        setResolved(controller.resolve("auto"));
        arm();
      }, controller.msUntilNextFlip());
    };
    arm();
    return () => clearTimeout(timer);
  }, [preference, controller]);

  // Cross-tab: another tab changed the stored preference.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setPreferenceState(controller.preference());
      setResolved(controller.resolve());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [controller]);

  const setPreference = useCallback(
    (next: ThemePreference): void => {
      controller.setPreference(next);
      setPreferenceState(next);
      setResolved(controller.resolve(next));
    },
    [controller],
  );

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
