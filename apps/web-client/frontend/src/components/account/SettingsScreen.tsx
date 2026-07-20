"use client";

import type { ReactElement } from "react";
import { Palette } from "lucide-react";
import { Card } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LanguageSettingsSection } from "@/components/settings/LanguageSettingsSection";
import { formatMessage } from "@/domain/i18n";
import { DARK_START_HOUR, LIGHT_START_HOUR } from "@/domain/theme";

/**
 * `/account/settings` (E32+E33): device-level preferences. Works logged-out
 * too — theme and language live on THIS device (localStorage / fp_locale
 * cookie), not on the account.
 */
export function SettingsScreen(): ReactElement {
  const { t } = useI18n();
  const { preference, resolved } = useTheme();
  const themeLabel = { light: t.settings.themeLight, dark: t.settings.themeDark }[resolved];
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
      <h1 className="fp-title-page font-display font-bold text-ink">{t.settings.title}</h1>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <Palette className="size-5 text-violet" aria-hidden />
          <h2 className="fp-title-section font-display font-semibold text-ink">
            {t.settings.appearance}
          </h2>
        </div>
        <p className="max-w-prose text-sm text-ink-secondary">
          {formatMessage(t.settings.appearanceDescription, {
            from: `${String(LIGHT_START_HOUR).padStart(2, "0")}:00`,
            to: `${DARK_START_HOUR}:00`,
          })}
        </p>
        <ThemeToggle />
        {preference === "auto" && (
          <p className="text-xs text-ink-muted">
            {formatMessage(t.settings.appearanceAutoNow, { theme: themeLabel })}
          </p>
        )}
      </Card>

      <LanguageSettingsSection />
    </div>
  );
}
