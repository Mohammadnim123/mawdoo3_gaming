"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, FolderTree, MessageSquarePlus } from "lucide-react";
import type { JobDraftFile } from "@codply/contracts";
import { Badge, Button, CodePane, EmptyState, FileTree, cn } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { workspaceDraftKey } from "./queryKeys";

const ENTRY = "index.html";

/** Tree kind by extension — the draft carries text files only (B44). */
function kindFor(path: string): "code" | "data" {
  return /\.(html|js|mjs)$/i.test(path) ? "code" : "data";
}

export interface DraftCodeViewProps {
  jobId: string;
  /** Poll while the job streams; a terminal job fetches once and holds. */
  running: boolean;
  onBackToChat: () => void;
  className?: string;
}

/**
 * Live draft browser (E04-F14 / E14-F5 / B44): renders `GET /jobs/{id}/draft` —
 * EVERY bundle text file AS IT IS BEING WRITTEN (~2s cadence while the job
 * streams), and the failed attempt's last draft on version-less projects
 * (recovery context). Tree left, read-only pane right; index.html is home.
 */
export function DraftCodeView({
  jobId,
  running,
  onBackToChat,
  className,
}: DraftCodeViewProps): ReactElement {
  const { t } = useI18n();
  const draftQuery = useQuery({
    queryKey: workspaceDraftKey(jobId),
    queryFn: ({ signal }) => getServices().jobs.draft(jobId, signal),
    refetchInterval: running ? 2000 : false,
    staleTime: running ? 0 : 30_000,
  });
  const content = draftQuery.data?.content ?? null;
  const files = useMemo<JobDraftFile[]>(() => {
    const items = draftQuery.data?.files ?? [];
    if (items.length > 0) return items;
    // Pre-B44 workers stream only the entry — synthesize the one-file bundle.
    return content !== null ? [{ path: ENTRY, content }] : [];
  }, [content, draftQuery.data?.files]);

  const [selectedPath, setSelectedPath] = useState(ENTRY);
  const [treeOpen, setTreeOpen] = useState(false);
  // Draft files can vanish between polls (agent restructures) — go home.
  useEffect(() => {
    if (files.length > 0 && !files.some((f) => f.path === selectedPath)) {
      setSelectedPath(ENTRY);
    }
  }, [files, selectedPath]);

  if (files.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center p-4", className)}>
        <EmptyState
          icon={FileCode2}
          title={running ? t.workspace.draft.warmingUp : t.workspace.draft.noDraft}
          description={
            running ? t.workspace.draft.warmingUpDescription : t.workspace.draft.noDraftDescription
          }
          className="w-full max-w-md border-0 bg-transparent"
        />
      </div>
    );
  }

  const selected = files.find((f) => f.path === selectedPath) ?? files[0]!;
  const treeFiles = files.map((f) => ({
    path: f.path,
    kind: kindFor(f.path),
    editable: f.path === ENTRY,
  }));
  const openFile = (path: string): void => {
    setSelectedPath(path);
    setTreeOpen(false);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2 p-2 sm:p-3", className)}>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden"
          onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen}
          leftIcon={<FolderTree className="size-4 text-warning" aria-hidden />}
        >
          {t.workspace.codeView.files}
        </Button>
        <FileCode2 className="hidden size-4 shrink-0 text-cyan sm:block" aria-hidden />
        <span className="min-w-0 truncate font-mono text-sm font-medium" dir="ltr">
          {selected.path}
        </span>
        <Badge tone={running ? "info" : "warning"} data-testid="draft-badge">
          {running ? (
            <>
              <span className="fp-pulse me-1 inline-block size-1.5 rounded-full bg-current" aria-hidden />
              {t.workspace.draft.beingWritten}
            </>
          ) : (
            t.workspace.draft.lastAttempt
          )}
        </Badge>
        {!running && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToChat}
            leftIcon={<MessageSquarePlus className="size-4" aria-hidden />}
            className="ms-auto"
          >
            {t.workspace.draft.askToFix}
          </Button>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1 gap-2">
        {/* Tree: rail ≥sm, dropdown panel below (same pattern as CodeView). */}
        <aside className="hidden w-56 shrink-0 overflow-y-auto rounded-2xl border border-edge-subtle p-2 sm:block">
          <FileTree
            files={treeFiles}
            selectedPath={selected.path}
            onSelect={openFile}
            aria-label={t.ui.filesTree}
          />
        </aside>
        {treeOpen && (
          <div className="absolute inset-x-2 top-1 z-30 max-h-72 overflow-y-auto rounded-2xl border border-edge bg-surface-3 p-2 sm:hidden">
            <FileTree
              files={treeFiles}
              selectedPath={selected.path}
              onSelect={openFile}
              aria-label={t.ui.filesTree}
            />
          </div>
        )}
        <div className="min-h-0 min-w-0 flex-1">
          <CodePane
            value={selected.content}
            readOnly
            filename={selected.path}
            height="100%"
            labels={{
              copy: t.ui.copySource,
              copied: t.common.copied,
              download: t.ui.downloadSource,
              readOnly: t.ui.readOnly,
            }}
          />
        </div>
      </div>
    </div>
  );
}
