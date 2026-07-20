"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { ArrowLeft, Compass, Hourglass, Zap } from "lucide-react";
import { Badge, Button, Card } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useQuotaCountdown } from "./QuotaChip";

/** Quota-exhausted card: reset countdown + a nudge toward the feed. */
export function UpsellCard({ onBack }: { onBack: () => void }): ReactElement {
  const { t, f } = useI18n();
  const countdown = useQuotaCountdown();
  return (
    <Card className="flex flex-col items-center gap-4 p-8 text-center">
      <Zap className="size-10 text-warning" aria-hidden />
      <h1 className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold">
        {t.create.upsell.title}
      </h1>
      <p className="text-sm text-ink-secondary">{t.create.upsell.description}</p>
      <Badge tone="warning" leading={<Hourglass className="size-3" aria-hidden />}>
        {f.msg(t.create.upsell.quotaResets, { countdown })}
      </Badge>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/feed">
          <Button variant="gradient-cta" leftIcon={<Compass className="size-4" aria-hidden />}>
            {t.create.upsell.exploreFeed}
          </Button>
        </Link>
        <Button variant="ghost" onClick={onBack} leftIcon={<ArrowLeft className="fp-flip-rtl size-4" aria-hidden />}>
          {t.common.back}
        </Button>
      </div>
    </Card>
  );
}
