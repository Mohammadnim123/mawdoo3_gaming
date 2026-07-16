"use client";

import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Code2 } from "lucide-react";
import { CodePane, Dialog, Skeleton } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";

export interface ViewCodeDialogProps {
  gameId: string;
  versionId: string;
  title: string;
}

/**
 * "View code" — the anti-lock-in loop: anyone can read a public game's
 * source. Lazy-fetches on first open.
 */
export function ViewCodeDialog({ gameId, versionId, title }: ViewCodeDialogProps): ReactElement {
  const { t, f } = useI18n();
  const [open, setOpen] = useState(false);
  const { data: source, isPending, isError } = useQuery({
    queryKey: ["source", gameId, versionId],
    queryFn: () => getServices().games.source(gameId, versionId),
    enabled: open,
    staleTime: Infinity,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fp-hit flex items-center gap-1.5 font-medium text-ink-secondary transition-colors duration-150 ease-out hover:text-ink"
      >
        <Code2 className="size-4" aria-hidden />
        {t.game.viewCode}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={f.msg(t.game.sourceTitle, { title })}
        closeLabel={t.ui.closeDialog}
        className="sm:max-w-2xl"
      >
        <div className="w-full min-w-0">
          {isPending && <Skeleton className="h-64 w-full" />}
          {isError && <p className="text-sm text-danger">{t.game.sourceLoadFailed}</p>}
          {source !== undefined && (
            <CodePane
              value={source}
              readOnly
              height="min(420px, 55dvh)"
              labels={{
                copy: t.ui.copySource,
                copied: t.common.copied,
                download: t.ui.downloadSource,
                readOnly: t.ui.readOnly,
              }}
            />
          )}
        </div>
      </Dialog>
    </>
  );
}
