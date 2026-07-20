"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@codply/contracts";
import { useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useInvalidateCredits } from "@/domain/hooks/useCredits";

/**
 * The "Claim Daily" action (E29): success toast with the granted amount,
 * 409 → info toast with when the claim resets, 400 → the plan has no claim.
 */
export function useClaimDaily(): { claim: () => Promise<void>; claiming: boolean } {
  const { t, f } = useI18n();
  const { toast } = useToast();
  const invalidateCredits = useInvalidateCredits();
  const [claiming, setClaiming] = useState(false);

  const claim = useCallback(async (): Promise<void> => {
    if (claiming) return;
    setClaiming(true);
    try {
      const { granted } = await getServices().account.claimDaily();
      toast({
        title: f.msg(t.credits.claimGranted, { count: granted }),
        description: t.credits.claimGrantedDescription,
        variant: "success",
      });
      await invalidateCredits();
    } catch (error) {
      if (ApiError.isApiError(error) && error.code === "conflict") {
        const nextClaimAt = error.details["next_claim_at"];
        const wait = typeof nextClaimAt === "string" ? f.until(nextClaimAt) : "";
        toast({
          title: t.credits.alreadyClaimed,
          description: wait !== "" ? f.msg(t.credits.nextClaimIn, { countdown: wait }) : undefined,
          variant: "info",
        });
      } else if (ApiError.isApiError(error) && error.code === "validation_error") {
        toast({
          title: t.credits.noDailyClaim,
          description: t.credits.noDailyClaimDescription,
          variant: "info",
        });
      } else {
        toast({ title: t.credits.claimFailed, variant: "error" });
      }
    } finally {
      setClaiming(false);
    }
  }, [claiming, invalidateCredits, toast, t, f]);

  return { claim, claiming };
}
