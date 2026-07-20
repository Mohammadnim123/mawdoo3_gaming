"use client";

import { useState, type ReactElement } from "react";
import type { Monetization } from "@codply/contracts";
import { Button, Dialog, Notice, Progress } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";

/** "$0.20" / "$10.00" — payouts always show exact cents (plan prices don't). */
export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The always-visible earning-conditions callout (E36). Every number in the
 * dialog comes from the API's monetization block — nothing is hardcoded, so
 * program changes never need a frontend release.
 */
export function EarnConditionsBanner({
  monetization,
}: {
  monetization: Monetization | null;
}): ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Notice
        tone="warning"
        action={
          <Button variant="ghost" size="sm" disabled={!monetization} onClick={() => setOpen(true)}>
            {t.dashboard.viewConditions}
          </Button>
        }
      >
        {t.dashboard.conditionsBanner}
      </Notice>
      {monetization && (
        <EarnConditionsDialog
          open={open}
          onClose={() => setOpen(false)}
          monetization={monetization}
        />
      )}
    </>
  );
}

export interface EarnConditionsDialogProps {
  open: boolean;
  onClose: () => void;
  monetization: Monetization;
}

export function EarnConditionsDialog({
  open,
  onClose,
  monetization,
}: EarnConditionsDialogProps): ReactElement {
  const { t, f } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.dashboard.conditionsTitle}
      closeLabel={t.ui.closeDialog}
    >
      <div className="flex flex-col gap-4">
        <Condition
          title={t.dashboard.cpmTitle}
          body={f.msg(t.dashboard.cpmBody, {
            min: formatDollars(monetization.cpm_min_cents),
            max: formatDollars(monetization.cpm_max_cents),
          })}
        />
        <Condition
          title={t.dashboard.maxPaidPlaysTitle}
          body={f.msg(t.dashboard.maxPaidPlaysBody, {
            count: f.number(monetization.max_paid_plays),
          })}
        />
        <Condition
          title={t.dashboard.minGamesTitle}
          body={f.msg(t.dashboard.minGamesBody, { count: f.number(monetization.min_live_games) })}
        >
          <div className="flex items-center gap-2 pt-1">
            <Progress
              value={Math.min(monetization.live_games, monetization.min_live_games)}
              max={monetization.min_live_games}
              label={t.dashboard.minGamesTitle}
              className="flex-1"
            />
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">
              {f.msg(t.dashboard.minGamesProgress, {
                current: f.number(monetization.live_games),
                total: f.number(monetization.min_live_games),
              })}
            </span>
          </div>
        </Condition>
        <Condition
          title={t.dashboard.freeDailyTitle}
          body={f.msg(t.dashboard.freeDailyBody, {
            count: f.number(monetization.free_daily_generations),
          })}
        />
        <Condition
          title={t.dashboard.minPayoutTitle}
          body={f.msg(t.dashboard.minPayoutBody, {
            amount: formatDollars(monetization.min_payout_cents),
          })}
        />
      </div>
    </Dialog>
  );
}

function Condition({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactElement;
}): ReactElement {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <p className="text-sm text-ink-secondary">{body}</p>
      {children}
    </section>
  );
}
