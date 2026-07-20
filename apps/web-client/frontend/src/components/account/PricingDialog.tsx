"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { SubscriptionInterval } from "@codply/contracts";
import { ApiError } from "@codply/contracts";
import { Dialog, PricingCard, SegmentedControl, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useInvalidateCredits, useSubscription } from "@/domain/hooks/useCredits";
import { PRO_PLAN_DISPLAY, planPriceLabel } from "@/domain/billing";

export interface PricingDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The upgrade sheet (E29): Monthly/Yearly toggle, the Pro card (checkout)
 * and the contact-only Studio card. Checkout follows the returned url — in
 * dev that is a same-origin redirect back to `/account/billing`.
 */
export function PricingDialog({ open, onClose }: PricingDialogProps): ReactElement {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const invalidateCredits = useInvalidateCredits();
  const { data: subscription } = useSubscription();
  // Default true so a not-yet-loaded (or older) API doesn't hide the button.
  const checkoutAvailable = subscription?.checkout_available ?? true;
  const [interval, setInterval] = useState<SubscriptionInterval>("monthly");
  const [checkingOut, setCheckingOut] = useState(false);

  const intervals = [
    { value: "monthly", label: t.pricing.monthly },
    { value: "yearly", label: t.pricing.yearly },
  ] as const;

  const upgrade = async (): Promise<void> => {
    if (checkingOut) return;
    setCheckingOut(true);
    try {
      const { url } = await getServices().account.checkout(PRO_PLAN_DISPLAY.key, interval);
      const target = new URL(url, window.location.origin);
      if (target.origin === window.location.origin) {
        // Dev fake provider: the plan is already active — refresh and land
        // on the billing panel it points at.
        await invalidateCredits();
        onClose();
        router.push(`${target.pathname}${target.search}` as Route);
      } else {
        // Real payment provider: hand the tab over to the checkout page.
        window.location.assign(target.toString());
      }
    } catch (error) {
      toast({
        title: t.pricing.checkoutFailed,
        description: ApiError.isApiError(error) ? error.message : t.common.tryAgainLater,
        variant: "error",
      });
    } finally {
      setCheckingOut(false);
    }
  };

  const contactStudio = (): void => {
    toast({
      title: t.pricing.studioContactTitle,
      description: t.pricing.studioContactDescription,
      variant: "info",
    });
  };

  // No payment adapter wired (audit 2026-07): don't send the user into a 503 —
  // point them at contact instead, matching the API's honest capability flag.
  const contactToUpgrade = (): void => {
    toast({
      title: t.pricing.checkoutUnavailableTitle,
      description: t.pricing.checkoutUnavailableDescription,
      variant: "info",
    });
  };

  const proPrice = planPriceLabel(PRO_PLAN_DISPLAY, interval, {
    free: t.billing.free,
    perMonth: t.billing.perMonth,
    perYear: t.billing.perYear,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.pricing.title}
      description={t.pricing.description}
      closeLabel={t.ui.closeDialog}
      className="sm:max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          options={intervals}
          value={interval}
          onChange={setInterval}
          aria-label={t.pricing.billingInterval}
          className="self-center"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PricingCard
            name={t.pricing.proName}
            price={proPrice.price}
            period={proPrice.period}
            badge={t.pricing.mostPopular}
            features={[...t.pricing.proFeatures]}
            highlighted
            ctaLabel={checkoutAvailable ? t.pricing.getStarted : t.pricing.contactUs}
            onCta={checkoutAvailable ? () => void upgrade() : contactToUpgrade}
            ctaLoading={checkingOut}
          />
          <PricingCard
            name={t.pricing.studioName}
            price={t.pricing.custom}
            features={[...t.pricing.studioFeatures]}
            marker="dot"
            ctaLabel={t.pricing.contactUs}
            onCta={contactStudio}
          />
        </div>
      </div>
    </Dialog>
  );
}
