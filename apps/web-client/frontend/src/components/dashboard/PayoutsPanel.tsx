"use client";

import { useState, type ReactElement } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { ApiError, type PayoutsResponse } from "@codply/contracts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
  Skeleton,
  useToast,
  type BadgeTone,
} from "@codply/ui";
import { getServices } from "@/domain/services";
import {
  CREATOR_PAYOUTS_QUERY_KEY,
  useCreatorPayouts,
  useInvalidateCreator,
  usePayoutIdempotencyKey,
} from "@/domain/hooks/useCreator";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatDollars } from "./EarnConditions";

const PAYOUT_STATUS_TONES: Record<string, BadgeTone> = {
  pending: "warning",
  paid: "success",
  rejected: "danger",
};

/** Payouts tab (E36): balance vs. minimum, the request CTA and the history. */
export function PayoutsPanel(): ReactElement {
  const { t, f } = useI18n();
  // Only mounted while the tab is active and the viewer is logged in.
  const query = useCreatorPayouts(true);
  const queryClient = useQueryClient();
  const invalidateCreator = useInvalidateCreator();
  const { toast } = useToast();
  const [requesting, setRequesting] = useState(false);
  // One key per payout INTENT — reused across retries so the server replays a
  // request whose response got lost instead of paying twice (W1).
  const idempotency = usePayoutIdempotencyKey(query.data?.pages[0]?.can_request ?? false);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  // Balance/gating/pending ride the head page; later pages extend the history.
  const pages = query.data?.pages ?? [];
  const payouts = pages[0];
  if (query.isError || payouts === undefined) {
    return (
      <EmptyState
        icon={Wallet}
        title={t.dashboard.payoutsErrorTitle}
        description={t.dashboard.payoutsErrorDescription}
        action={
          <Button variant="soft" onClick={() => void query.refetch()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  const history = pages.flatMap((page) => page.items);
  const statusLabels: Record<string, string> = t.dashboard.statuses;
  const remainingCents = Math.max(0, payouts.min_payout_cents - payouts.balance_cents);

  const request = async (): Promise<void> => {
    setRequesting(true);
    try {
      // Money mutation — the idempotency key guards double-submits (E36).
      const result = await getServices().account.requestPayout(idempotency.mint());
      // Request settled — the next payout intent gets a fresh key.
      idempotency.reset();
      // The POST responds with the refreshed head page — write it straight in
      // (history restarts from the top; older pages refetch on demand).
      queryClient.setQueryData<InfiniteData<PayoutsResponse>>(CREATOR_PAYOUTS_QUERY_KEY, {
        pages: [result],
        pageParams: [undefined],
      });
      toast({ title: t.dashboard.payoutRequested, variant: "success" });
    } catch (err) {
      // 400 below minimum / 409 already pending — surface the server message.
      toast({
        title: t.dashboard.requestFailed,
        description: ApiError.isApiError(err) ? err.message : undefined,
        variant: "error",
      });
      // A 409 means server state moved under us — re-sync both creator caches
      // so the panel reflects reality (W5). The key survives unless the fresh
      // snapshot says the intent is gone (can_request=false).
      void invalidateCreator();
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-sm font-bold text-ink-secondary">{t.dashboard.availableBalance}</h2>
        <p className="font-[family-name:var(--font-space-grotesk)] text-3xl font-bold tabular-nums text-ink">
          {formatDollars(payouts.balance_cents)}
        </p>
        <Progress
          value={Math.min(payouts.balance_cents, payouts.min_payout_cents)}
          max={payouts.min_payout_cents}
          label={t.dashboard.availableBalance}
        />
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span>
            {f.msg(t.dashboard.minPayout, { amount: formatDollars(payouts.min_payout_cents) })}
          </span>
          {payouts.can_request ? (
            <span className="text-success">{t.dashboard.readyToRequest}</span>
          ) : (
            <span>{f.msg(t.dashboard.toGo, { amount: formatDollars(remainingCents) })}</span>
          )}
        </div>
        <Button
          variant="gradient-cta"
          className="w-full"
          disabled={!payouts.can_request}
          loading={requesting}
          onClick={() => void request()}
        >
          {t.dashboard.requestPayout}
        </Button>
        {payouts.pending && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <span className="text-ink-secondary">{t.dashboard.pendingPayout}</span>
            <span className="flex items-center gap-2">
              <span className="font-semibold tabular-nums text-ink">
                {formatDollars(payouts.pending.amount_cents)}
              </span>
              <Badge tone="warning">
                {statusLabels[payouts.pending.status] ?? payouts.pending.status}
              </Badge>
            </span>
          </div>
        )}
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-ink-secondary">{t.dashboard.history}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.dashboard.noPayoutsYet}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {history.map((payout) => (
                <li
                  key={payout.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-1 px-3 py-2"
                >
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {formatDollars(payout.amount_cents)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={PAYOUT_STATUS_TONES[payout.status] ?? "neutral"}>
                      {statusLabels[payout.status] ?? payout.status}
                    </Badge>
                    <span className="text-xs text-ink-muted">{f.shortDate(payout.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {t.dashboard.loadMoreHistory}
              </Button>
            )}
          </>
        )}
      </section>

      <Card className="p-4 text-sm text-ink-secondary">
        {t.dashboard.supportPrompt}{" "}
        <a
          href="mailto:support@codply.com"
          className="text-ink underline transition-colors duration-150 ease-out hover:text-violet"
        >
          {t.dashboard.contactSupport}
        </a>
      </Card>
    </div>
  );
}
