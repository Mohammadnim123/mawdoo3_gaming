"use client";

import type { ReactElement } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { SegmentedControl } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useTheme } from "./ThemeProvider";

/** Light / Auto / Dark preference switch (Auto follows the time of day). */
export function ThemeToggle({ className }: { className?: string }): ReactElement {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl
      options={[
        { value: "light", label: t.settings.themeLight, icon: Sun },
        { value: "auto", label: t.settings.themeAuto, icon: SunMoon },
        { value: "dark", label: t.settings.themeDark, icon: Moon },
      ]}
      value={preference}
      onChange={setPreference}
      aria-label={t.settings.appearanceTheme}
      className={className}
    />
  );
}
