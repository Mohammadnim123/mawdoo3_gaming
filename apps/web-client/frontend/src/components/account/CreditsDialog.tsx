"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { Button, CreditLedgerList, CreditBalance, Dialog, Skeleton } from "@codply/ui";
import { getServices } from "@/domain/services";
import { creditKindLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CREDITS_QUERY_KEY } from "@/domain/hooks/useCredits";

const PAGE_SIZE = 20;

export interface CreditsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Credits Overview (E29): the big balance + the paged ledger, with a
 * "Manage subscription" hand-off to `/account/billing`.
 */
export function CreditsDialog({ open, onClose }: CreditsDialogProps): ReactElement {
  const { t, f } = useI18n();
  const creditsQuery = useInfiniteQuery({
    queryKey: CREDITS_QUERY_KEY,
    queryFn: ({ pageParam }) =>
      getServices().account.credits({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: open,
  });

  // Balance rides the first page; later pages only extend the ledger.
  const balance = creditsQuery.data?.pages[0]?.balance ?? null;
  const rows = creditsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.credits.title}
      description={t.credits.description}
      closeLabel={t.ui.closeDialog}
      footer={
        <Link href="/account/billing" onClick={onClose}>
          <Button variant="soft" size="sm" leftIcon={<CreditCard className="size-4" aria-hidden />}>
            {t.credits.manageSubscription}
          </Button>
        </Link>
      }
    >
      {creditsQuery.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : creditsQuery.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-ink-secondary">{t.credits.loadFailed}</p>
          <Button variant="soft" size="sm" onClick={() => void creditsQuery.refetch()}>
            {t.common.retry}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <CreditBalance
            balance={balance ?? 0}
            size="lg"
            label={t.credits.balanceLabel}
            formatNumber={f.number}
          />
          <CreditLedgerList
            rows={rows}
            hasMore={creditsQuery.hasNextPage}
            loadingMore={creditsQuery.isFetchingNextPage}
            onLoadMore={() => void creditsQuery.fetchNextPage()}
            kindLabel={(kind) => creditKindLabel(t, kind)}
            loadMoreLabel={t.common.loadMore}
            emptyLabel={t.credits.ledgerEmpty}
            formatTime={f.dateTime}
          />
        </div>
      )}
    </Dialog>
  );
}
