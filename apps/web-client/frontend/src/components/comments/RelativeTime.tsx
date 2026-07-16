"use client";

import type { ReactElement } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

/** Compact localized relative timestamp ("3h", "2d", short-date fallback). */
export function RelativeTime({ iso }: { iso: string }): ReactElement {
  const { f } = useI18n();
  return <time dateTime={iso}>{f.timeAgo(iso)}</time>;
}
