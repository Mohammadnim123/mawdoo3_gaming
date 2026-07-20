"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError } from "@codply/contracts";
import { PromptComposer, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useInvalidateMe } from "@/domain/hooks/useMe";
import { rememberJobPrompt } from "@/domain/workspace/promptHandoff";
import { QuotaChip } from "./QuotaChip";
import { BriefCard } from "./BriefCard";
import { UpsellCard } from "./UpsellCard";

type ComposePhase = "compose" | "brief" | "quota";

/**
 * The marketing hero flow: compose → brief preview → (job created) →
 * hand off into the workspace (`/studio?job={id}`, E14-F1). Legacy
 * `/create?job=` deep links forward to the workspace too.
 */
export function CreateFlow(): ReactElement {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const invalidateMe = useInvalidateMe();

  const jobParam = searchParams.get("job");
  const [prompt, setPrompt] = useState(() => searchParams.get("idea") ?? "");
  const [phase, setPhase] = useState<ComposePhase>("compose");
  const [creating, setCreating] = useState(false);

  // Legacy deep links (`/create?job=…`) live in the workspace now.
  useEffect(() => {
    if (jobParam) router.replace(`/studio?job=${encodeURIComponent(jobParam)}`);
  }, [jobParam, router]);

  const startGeneration = useCallback(
    async (finalPrompt: string, skipQuestions?: boolean): Promise<void> => {
      if (creating) return;
      setCreating(true);
      try {
        const { job_id } = await getServices().jobs.generate(finalPrompt, {
          skipQuestions,
        });
        rememberJobPrompt(job_id, finalPrompt); // seeds the workspace thread
        await invalidateMe(); // quota consumed
        router.push(`/studio?job=${encodeURIComponent(job_id)}`);
      } catch (error) {
        if (ApiError.isApiError(error) && error.code === "quota_exceeded") {
          setPhase("quota");
        } else if (ApiError.isApiError(error) && error.code === "credits_exhausted") {
          // E29 admission gate — point at the claim/upgrade surface.
          toast({
            title: t.create.outOfCredits,
            description: t.create.outOfCreditsDescription,
            variant: "info",
          });
        } else if (ApiError.isApiError(error) && error.code === "moderation_blocked") {
          toast({
            title: t.create.promptBlocked,
            description: error.message,
            variant: "error",
          });
        } else {
          toast({
            title: t.create.startFailed,
            description: ApiError.isApiError(error) ? error.message : t.common.tryAgainLater,
            variant: "error",
          });
        }
      } finally {
        setCreating(false);
      }
    },
    [creating, invalidateMe, router, toast, t],
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10 md:py-16">
      {phase === "quota" && <UpsellCard onBack={() => setPhase("compose")} />}

      {phase === "compose" && (
        <>
          <header className="flex flex-col gap-2 text-center">
            <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
              {t.create.title}
            </h1>
            <p className="text-sm text-ink-secondary">{t.create.subtitle}</p>
          </header>
          <PromptComposer
            value={prompt}
            onChange={setPrompt}
            onSubmit={(trimmed) => {
              setPrompt(trimmed);
              setPhase("brief");
            }}
            quotaSlot={<QuotaChip />}
            placeholder={t.composer.placeholder}
            ctaLabel={t.create.continue}
            labels={{
              describe: t.composer.describeYourGame,
              examples: t.composer.examplePrompts,
              toGenerate: t.composer.toGenerate,
            }}
          />
        </>
      )}

      {phase === "brief" && (
        <BriefCard
          prompt={prompt}
          onPromptChange={setPrompt}
          onGenerate={(skipQuestions) => void startGeneration(prompt.trim(), skipQuestions)}
          onBack={() => setPhase("compose")}
          generating={creating}
        />
      )}
    </div>
  );
}
