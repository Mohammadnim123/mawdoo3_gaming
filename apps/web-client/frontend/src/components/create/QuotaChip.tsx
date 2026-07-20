"use client";

import { useEffect, useState, type ReactElement } from "react";
import { TimerReset, Zap } from "lucide-react";
import { Badge } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { msUntilQuotaReset, quotaRemaining } from "@/domain/quota";

/** Live localized countdown label to the UTC-midnight quota reset. */
export function useQuotaCountdown(): string {
  const { f } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return f.countdown(msUntilQuotaReset(new Date(now)));
}

/** Daily-quota indicator for the composer (`GET /me` → quota). */
export function QuotaChip(): ReactElement | null {
  const { t, f } = useI18n();
  const { data: me } = useMe();
  const countdown = useQuotaCountdown();
  if (!me) return null;
  const remaining = quotaRemaining(me.quota);
  if (remaining === 0) {
    return (
      <Badge tone="warning" leading={<TimerReset className="size-3" aria-hidden />}>
        {f.msg(t.create.resetsIn, { countdown })}
      </Badge>
    );
  }
  return (
    <Badge tone={remaining === 1 ? "warning" : "violet"} leading={<Zap className="size-3" aria-hidden />}>
      {f.msg(t.create.quotaToday, { remaining, limit: me.quota.daily_limit })}
    </Badge>
  );
}
