"use client";

import type { ReactElement } from "react";
import { Check, Languages } from "lucide-react";
import { Card, cn } from "@codply/ui";
import { LOCALES, type Locale } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";

const LOCALE_NAMES: Record<Locale, string> = { en: "English", ar: "العربية" };

/**
 * E33 — self-contained language section for a future settings page: renders
 * the language radio list, persists via LocaleController (fp_locale cookie)
 * and reloads into the chosen locale. Slot it into any settings layout;
 * it owns no page chrome.
 */
export function LanguageSettingsSection({ className }: { className?: string }): ReactElement {
  const { t, locale, setLocale } = useI18n();
  return (
    <Card className={cn("flex flex-col gap-3 p-5", className)} data-testid="language-settings">
      <h2 className="flex items-center gap-2 text-sm font-bold text-ink-secondary">
        <Languages className="size-4 text-violet" aria-hidden />
        {t.settings.language}
      </h2>
      <p className="text-xs text-ink-muted">{t.settings.languageDescription}</p>
      <div role="radiogroup" aria-label={t.settings.language} className="flex flex-col gap-1.5">
        {LOCALES.map((option) => {
          const selected = option === locale;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setLocale(option)}
              className={cn(
                "fp-hit flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-start text-sm",
                "transition-colors duration-150 ease-out",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
                selected
                  ? "border-violet bg-violet/10 text-ink"
                  : "border-edge bg-surface-2 text-ink-secondary hover:border-edge-strong hover:text-ink",
              )}
            >
              <span className="w-4">
                {selected && <Check className="size-4 text-violet" aria-hidden />}
              </span>
              {LOCALE_NAMES[option]}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
