"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import { ArrowLeft, Gamepad2, Ghost, LayoutDashboard, LayoutGrid, Wallet } from "lucide-react";
import {
  Button,
  EmptyState,
  IconButton,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useCreatorOverview, useCreatorPayouts } from "@/domain/hooks/useCreator";
import { EarnConditionsBanner } from "./EarnConditions";
import { OverviewPanel } from "./OverviewPanel";
import { MyGamesPanel } from "./MyGamesPanel";
import { PayoutsPanel } from "./PayoutsPanel";

/**
 * `/dashboard` (E36): creator stats, per-game analytics and payouts. Panels
 * mount lazily per tab; the queries here share the panels' cache keys and
 * only exist to hand the conditions banner whichever monetization block is
 * already loaded.
 */
export function DashboardScreen(): ReactElement {
  const { t } = useI18n();
  const { data: me, isPending: mePending } = useMe();
  const router = useRouter();
  const [tab, setTab] = useState("overview");

  const overviewQuery = useCreatorOverview(Boolean(me) && tab === "overview");
  const payoutsQuery = useCreatorPayouts(Boolean(me) && tab === "payouts");
  // Payouts is an infinite query now — the head page carries monetization.
  const monetization =
    overviewQuery.data?.monetization ?? payoutsQuery.data?.pages[0]?.monetization ?? null;

  if (mePending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={Ghost}
          title={t.account.notLoggedInTitle}
          description={t.dashboard.notLoggedInDescription}
          action={
            <Link href="/login?next=/dashboard">
              <Button variant="gradient-cta">{t.nav.logIn}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:py-8">
      <div className="flex items-center gap-2">
        <IconButton
          icon={ArrowLeft}
          aria-label={t.common.back}
          variant="ghost"
          size="sm"
          className="fp-flip-rtl"
          onClick={() => router.back()}
        />
        <h1 className="fp-title-page flex items-center gap-2 font-[family-name:var(--font-space-grotesk)] font-bold">
          <LayoutDashboard className="size-6 text-violet" aria-hidden />
          {t.dashboard.title}
        </h1>
      </div>

      <EarnConditionsBanner monetization={monetization} />

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <TabsList aria-label={t.dashboard.tabsAria}>
          <TabsTrigger value="overview" icon={LayoutGrid}>
            {t.dashboard.tabs.overview}
          </TabsTrigger>
          <TabsTrigger value="games" icon={Gamepad2}>
            {t.dashboard.tabs.games}
          </TabsTrigger>
          <TabsTrigger value="payouts" icon={Wallet}>
            {t.dashboard.tabs.payouts}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewPanel />
        </TabsContent>
        <TabsContent value="games">
          <MyGamesPanel />
        </TabsContent>
        <TabsContent value="payouts">
          <PayoutsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
