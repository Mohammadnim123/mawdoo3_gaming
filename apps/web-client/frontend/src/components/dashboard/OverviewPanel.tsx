"use client";

import type { ReactElement } from "react";
import { BarChart3, Bookmark, DollarSign, Gamepad2, Heart, Shuffle, Users } from "lucide-react";
import { Button, EmptyState, Skeleton, StatCard } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useCreatorOverview } from "@/domain/hooks/useCreator";
import { formatDollars } from "./EarnConditions";

/** Overview tab (E36): six lifetime StatCards from `GET /me/creator/overview`. */
export function OverviewPanel(): ReactElement {
  const { t } = useI18n();
  // Only mounted while the tab is active and the viewer is logged in.
  const query = useCreatorOverview(true);

  if (query.isPending) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[5.5rem] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        icon={BarChart3}
        title={t.dashboard.overviewErrorTitle}
        description={t.dashboard.overviewErrorDescription}
        action={
          <Button variant="soft" onClick={() => void query.refetch()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  const { stats, earnings } = query.data;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatCard icon={Users} label={t.dashboard.stats.followers} value={stats.followers} />
      <StatCard icon={Gamepad2} label={t.dashboard.stats.plays} value={stats.plays} />
      <StatCard icon={Heart} label={t.dashboard.stats.likes} value={stats.likes} />
      <StatCard icon={Shuffle} label={t.dashboard.stats.remixes} value={stats.remixes} />
      <StatCard icon={Bookmark} label={t.dashboard.stats.saves} value={stats.saves} />
      <StatCard
        icon={DollarSign}
        label={t.dashboard.stats.earnings}
        value={formatDollars(earnings.total_earned_cents)}
      />
    </div>
  );
}
