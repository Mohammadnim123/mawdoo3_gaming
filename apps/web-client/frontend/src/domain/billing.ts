import type { SubscriptionInterval, SubscriptionPlan } from "@codply/contracts";

/**
 * Pricing-dialog copy for the UPGRADE tiers (E29). The API only exposes the
 * viewer's CURRENT plan (`GET /me/subscription`), so upgrade tiles are
 * client-side display copy that MIRRORS the backend catalog
 * (`packages/core-py/forgeplay_core/domain/plans.py`) — keep them in sync.
 */
export const PRO_PLAN_DISPLAY = {
  key: "pro",
  name: "Pro (Creators)",
  monthly_price_cents: 1500,
  yearly_price_cents: 14_400,
  features: [
    "1,000 credits every month",
    "Bigger build budgets per game",
    "Priority generation queue",
    "No free-tier daily limits",
  ],
} as const;

export const STUDIO_PLAN_DISPLAY = {
  key: "studio",
  name: "Studio",
  features: [
    "Custom credit volume",
    "The biggest build budgets",
    "Priority support",
    "Manual onboarding with the team",
  ],
} as const;

/** Wire feature keys → human copy for the current-plan card. */
const FEATURE_LABELS: Record<string, string> = {
  daily_claim: "Free daily credit claim",
  public_games: "Publish public games",
  remix: "Remix any public game",
  monthly_credits: "Monthly credit grant",
  bigger_budgets: "Bigger build budgets",
  priority_queue: "Priority generation queue",
  custom_credits: "Custom credit volume",
  biggest_budgets: "The biggest build budgets",
  priority_support: "Priority support",
};

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/_/g, " ");
}

/** Whether a plan has the daily claim (drives the "Claim Daily" menu entry). */
export function hasDailyClaim(plan: SubscriptionPlan): boolean {
  return plan.features.includes("daily_claim");
}

/** "$15" / "$14.50" — whole dollars stay whole. */
export function formatPriceCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Localizable copy for the price label (defaults keep the English UI). */
export interface PlanPriceLabels {
  free: string;
  perMonth: string;
  perYear: string;
}

const DEFAULT_PRICE_LABELS: PlanPriceLabels = {
  free: "Free",
  perMonth: "/month",
  perYear: "/year",
};

/** Price + cadence for a plan card at the given interval ("Free" at $0). */
export function planPriceLabel(
  plan: Pick<SubscriptionPlan, "monthly_price_cents" | "yearly_price_cents">,
  interval: SubscriptionInterval,
  labels: PlanPriceLabels = DEFAULT_PRICE_LABELS,
): { price: string; period?: string } {
  const cents = interval === "yearly" ? plan.yearly_price_cents : plan.monthly_price_cents;
  if (cents === 0) return { price: labels.free };
  return {
    price: formatPriceCents(cents),
    period: interval === "yearly" ? labels.perYear : labels.perMonth,
  };
}

/** "4h 12m" / "12m" / "<1m" until `iso` (claim resets, period rollovers). */
export function formatUntil(iso: string, now: Date = new Date()): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  const totalMinutes = Math.floor((target - now.getTime()) / 60_000);
  if (totalMinutes < 1) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
