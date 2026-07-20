"use client";

import type { ReactElement } from "react";
import { Sparkles } from "lucide-react";
import { Button, CreditBalance, Dialog } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";

export interface CreditsExhaustedDialogProps {
  open: boolean;
  /** Balance from the 402 envelope's details (null when it wasn't sent). */
  balance: number | null;
  onClose: () => void;
  /** Opens the pricing dialog. */
  onGetMore: () => void;
}

/**
 * Shown when a send/generate fails with `credits_exhausted` (402, E29):
 * the remaining balance plus the "Get more credits" upsell.
 */
export function CreditsExhaustedDialog({
  open,
  balance,
  onClose,
  onGetMore,
}: CreditsExhaustedDialogProps): ReactElement {
  const { t, f } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.credits.exhaustedTitle}
      description={t.credits.exhaustedDescription}
      closeLabel={t.ui.closeDialog}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.credits.notNow}
          </Button>
          <Button
            variant="gradient-cta"
            size="sm"
            onClick={onGetMore}
            leftIcon={<Sparkles className="size-4" aria-hidden />}
          >
            {t.credits.getMore}
          </Button>
        </>
      }
    >
      {balance !== null && (
        <div className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3">
          <CreditBalance balance={balance} label={t.credits.creditsLeft} formatNumber={f.number} />
          <p className="text-xs text-ink-muted">{t.credits.exhaustedHint}</p>
        </div>
      )}
    </Dialog>
  );
}
