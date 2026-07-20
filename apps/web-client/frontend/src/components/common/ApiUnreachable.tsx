"use client";

import type { ReactElement } from "react";
import { Unplug } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";

/** Friendly flat card for when the API can't be reached from the server. */
export function ApiUnreachable(): ReactElement {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <Unplug className="size-10 text-warning" aria-hidden />
      <h1 className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold">
        {t.errors.apiUnreachableTitle}
      </h1>
      <p className="text-sm text-ink-secondary">{t.errors.apiUnreachableDescription}</p>
    </div>
  );
}
