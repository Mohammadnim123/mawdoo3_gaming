"use client";

import { useState, type ReactElement } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, FileText, PencilLine, Sparkles, Zap } from "lucide-react";
import { Button, Card, Textarea, Toggle, transition } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";

export interface BriefCardProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: (skipQuestions: boolean) => void;
  onBack: () => void;
  generating: boolean;
}

/**
 * "Here's what we'll build" preview between compose and generate —
 * the brief is editable inline before committing a quota unit.
 * (The pipeline's Enhancer refines it server-side once the job starts;
 * there is no pre-job enhance endpoint in the API contract.)
 */
export function BriefCard({
  prompt,
  onPromptChange,
  onGenerate,
  onBack,
  generating,
}: BriefCardProps): ReactElement {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [skipQuestions, setSkipQuestions] = useState(false);
  const valid = prompt.trim().length >= 3 && prompt.length <= 1000;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={transition.base}>
      <Card className="flex flex-col gap-4 p-5">
        <header className="flex items-center gap-2">
          <FileText className="size-5 text-cyan" aria-hidden />
          <h1 className="font-[family-name:var(--font-space-grotesk)] text-lg font-bold">
            {t.create.brief.title}
          </h1>
        </header>

        {editing ? (
          <Textarea
            label={t.create.brief.yourBrief}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            maxLength={1000}
            showCount
            rows={5}
            autoFocus
          />
        ) : (
          <blockquote className="rounded-2xl border border-edge bg-surface-2 p-4 text-sm leading-relaxed text-ink">
            {prompt}
          </blockquote>
        )}

        <Toggle
          checked={skipQuestions}
          onCheckedChange={setSkipQuestions}
          label={t.create.brief.surpriseMe}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle pt-4">
          <Button
            variant="gradient-cta"
            onClick={() => onGenerate(skipQuestions)}
            disabled={!valid}
            loading={generating}
            leftIcon={skipQuestions ? <Zap className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          >
            {t.create.brief.generate}
          </Button>
          <Button
            variant="soft"
            onClick={() => setEditing((v) => !v)}
            leftIcon={<PencilLine className="size-4" aria-hidden />}
          >
            {editing ? t.create.brief.doneEditing : t.create.brief.editBrief}
          </Button>
          <Button
            variant="ghost"
            onClick={onBack}
            leftIcon={<ArrowLeft className="fp-flip-rtl size-4" aria-hidden />}
          >
            {t.common.back}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
