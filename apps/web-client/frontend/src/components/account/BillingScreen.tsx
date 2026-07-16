"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { BadgeCheck, CreditCard, Ghost, Gift, History, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CreditBalance,
  EmptyState,
  PlanMeter,
  Skeleton,
  useToast,
} from "@codply/ui";
import { planFeatureLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useInvalidateCredits, useSubscription } from "@/domain/hooks/useCredits";
import { hasDailyClaim, planPriceLabel } from "@/domain/billing";
import { CreditsDialog } from "./CreditsDialog";
import { PricingDialog } from "./PricingDialog";
import { useClaimDaily } from "./useClaimDaily";

/**
 * `/account/billing` (E29): current plan card, the Plan Credits meter and
 * the credit-history hand-offs. Also the landing spot of the dev fake
 * checkout (`?checkout=success` → toast + cache refresh).
 */
export function BillingScreen(): ReactElement {
  const { t, f } = useI18n();
  const { data: me, isPending: mePending } = useMe();
  const subscriptionQuery = useSubscription(Boolean(me));
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const invalidateCredits = useInvalidateCredits();
  const { claim, claiming } = useClaimDaily();

  const [pricingOpen, setPricingOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);

  // The fake payment provider redirects here after activating the plan.
  const checkoutState = searchParams.get("checkout");
  const checkoutHandled = useRef(false);
  useEffect(() => {
    if (checkoutState !== "success" || checkoutHandled.current) return;
    checkoutHandled.current = true;
    toast({
      title: t.billing.planActivated,
      description: t.billing.planActivatedDescription,
      variant: "success",
    });
    void invalidateCredits();
    // Strip the query so reloads don't re-toast. Islands adaptation: the
    // reference calls router.replace, but Django owns routing so that shim
    // would trigger a full page load (killing the toast) — a same-document
    // history.replaceState is the equivalent client-side URL rewrite.
    window.history.replaceState(null, "", "/account/billing");
  }, [checkoutState, invalidateCredits, toast, t]);

  if (mePending || (me && subscriptionQuery.isPending)) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={Ghost}
          title={t.account.notLoggedInTitle}
          description={t.billing.notLoggedInDescription}
          action={
            <Link href="/login?next=/account/billing">
              <Button variant="gradient-cta">{t.nav.logIn}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const subscription = subscriptionQuery.data ?? null;
  if (subscription === null) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={CreditCard}
          title={t.billing.subscriptionErrorTitle}
          description={t.billing.subscriptionErrorDescription}
          action={
            <Button variant="soft" onClick={() => void subscriptionQuery.refetch()}>
              {t.common.retry}
            </Button>
          }
        />
      </div>
    );
  }

  const { price, period } = planPriceLabel(subscription.plan, subscription.interval, {
    free: t.billing.free,
    perMonth: t.billing.perMonth,
    perYear: t.billing.perYear,
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:py-8">
      <h1 className="fp-title-page flex items-center gap-2 font-[family-name:var(--font-space-grotesk)] font-bold">
        <CreditCard className="size-6 text-violet" aria-hidden />
        {t.billing.title}
      </h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-bold text-ink-secondary">{t.billing.currentPlan}</h2>
          <div className="flex items-center gap-2">
            <p className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold">
              {subscription.plan.name}
            </p>
            <Badge
              tone={subscription.status === "active" ? "success" : "warning"}
              leading={<BadgeCheck className="size-3" aria-hidden />}
            >
              {subscription.status === "active" ? t.billing.statusActive : subscription.status}
            </Badge>
          </div>
          <p className="text-lg font-semibold text-ink">
            {price}
            {period && <span className="text-sm font-medium text-ink-muted">{period}</span>}
          </p>
          <ul className="flex flex-col gap-1">
            {subscription.plan.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm text-ink-secondary">
                <Sparkles className="size-3.5 text-violet" aria-hidden />
                {planFeatureLabel(t, feature)}
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-2">
            <Button variant="gradient-cta" size="sm" onClick={() => setPricingOpen(true)}>
              {t.billing.upgradePlan}
            </Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-bold text-ink-secondary">{t.billing.planCredits}</h2>
          <PlanMeter
            remaining={subscription.credits.remaining}
            used={subscription.credits.used_this_period}
            total={subscription.credits.period_total}
            resetsAt={subscription.period_end}
            labels={{
              remaining: t.billing.remaining,
              used: t.billing.used,
              total: t.billing.total,
              resets: t.billing.resets,
              progress: t.billing.planCreditsUsed,
            }}
            formatDate={f.shortDate}
            formatNumber={f.number}
          />
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            <Button
              variant="soft"
              size="sm"
              onClick={() => setCreditsOpen(true)}
              leftIcon={<History className="size-4" aria-hidden />}
            >
              {t.billing.creditHistory}
            </Button>
            {hasDailyClaim(subscription.plan) && (
              <Button
                variant="soft"
                size="sm"
                loading={claiming}
                onClick={() => void claim()}
                leftIcon={<Gift className="size-4" aria-hidden />}
              >
                {t.billing.claimDailyCredits}
              </Button>
            )}
          </div>
        </Card>
      </div>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-sm font-bold text-ink-secondary">{t.billing.balance}</h2>
          <p className="text-xs text-ink-muted">{t.billing.balanceDescription}</p>
        </div>
        <CreditBalance
          balance={subscription.credits.remaining}
          label={t.credits.balanceLabel}
          formatNumber={f.number}
        />
      </Card>

      <PricingDialog open={pricingOpen} onClose={() => setPricingOpen(false)} />
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  );
}
