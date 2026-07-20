import type { ReactElement } from "react";
import { Check, Dot } from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "../primitives/Badge";
import { Button } from "../primitives/Button";

export interface PricingCardProps {
  /** Tier name, e.g. "Pro (Creators)". */
  name: string;
  /** Formatted price ("$15") or a phrase ("Custom"). */
  price: string;
  /** Cadence suffix after the price, e.g. "/month" — omit for phrases. */
  period?: string;
  /** Corner badge, e.g. "Most Popular". */
  badge?: string;
  /** Feature lines (display copy, already humanized). */
  features: string[];
  /** `check` = included-checklist rows; `dot` = plain feature bullets. */
  marker?: "check" | "dot";
  /** Highlighted tiers get the violet treatment + gradient CTA. */
  highlighted?: boolean;
  ctaLabel: string;
  onCta: () => void;
  ctaLoading?: boolean;
  className?: string;
}

/**
 * One tier of the pricing dialog (E29): name + badge, big price, feature
 * checklist and a full-width CTA. Flat per the design language — the
 * highlighted tier is drawn with a violet border, never a shadow.
 */
export function PricingCard({
  name,
  price,
  period,
  badge,
  features,
  marker = "check",
  highlighted = false,
  ctaLabel,
  onCta,
  ctaLoading = false,
  className,
}: PricingCardProps): ReactElement {
  const Marker = marker === "check" ? Check : Dot;
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        highlighted ? "border-violet/60 bg-violet/5" : "border-edge bg-surface-1",
        className,
      )}
      aria-label={`${name} plan`}
      data-testid="pricing-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-ink">{name}</h3>
        {badge && <Badge tone="violet">{badge}</Badge>}
      </div>
      <p className="flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold tabular-nums text-ink">{price}</span>
        {period && <span className="text-sm text-ink-muted">{period}</span>}
      </p>
      <ul className="flex flex-1 flex-col gap-1.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-ink-secondary">
            <Marker
              className={cn(
                "mt-0.5 size-4 shrink-0",
                marker === "check" ? "text-success" : "text-ink-muted",
              )}
              aria-hidden
            />
            {feature}
          </li>
        ))}
      </ul>
      <Button
        variant={highlighted ? "gradient-cta" : "soft"}
        onClick={onCta}
        loading={ctaLoading}
        className="w-full"
      >
        {ctaLabel}
      </Button>
    </section>
  );
}
