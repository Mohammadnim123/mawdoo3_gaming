import type { ReactElement } from "react";
import { Zap } from "lucide-react";
import { cn } from "../lib/cn";

export interface CreditBalanceProps {
  balance: number;
  /** `lg` is the Credits-dialog hero number; `md` fits panels and cards. */
  size?: "md" | "lg";
  /** Accessible label; default "Credit balance". */
  label?: string;
  /** Number renderer; default en-US grouping (apps pass a locale-bound one). */
  formatNumber?: (value: number) => string;
  className?: string;
}

/** Bolt + big balance number (E29) — the one way credits are displayed. */
export function CreditBalance({
  balance,
  size = "md",
  label = "Credit balance",
  formatNumber = (value) => value.toLocaleString("en-US"),
  className,
}: CreditBalanceProps): ReactElement {
  return (
    <p
      className={cn("flex items-center", size === "lg" ? "gap-2.5" : "gap-2", className)}
      aria-label={`${label}: ${formatNumber(balance)}`}
      data-testid="credit-balance"
    >
      <Zap
        className={cn("shrink-0 text-warning", size === "lg" ? "size-7" : "size-5")}
        fill="currentColor"
        aria-hidden
      />
      <span
        className={cn(
          "font-display font-bold tabular-nums text-ink",
          size === "lg" ? "text-4xl" : "text-2xl",
        )}
      >
        {formatNumber(balance)}
      </span>
    </p>
  );
}
