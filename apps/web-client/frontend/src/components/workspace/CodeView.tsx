"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  FlaskConical,
  FolderTree,
  Lock,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ApiError, type CurrentVersion, type GameDetail, type VersionFile } from "@codply/contracts";
import {
  AudioAssetRow,
  Button,
  CodePane,
  ConsolePane,
  EditorTabs,
  EmptyState,
  FileTree,
  Skeleton,
  cn,
  useToast,
  type EditorTab,
} from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { parseSourceFindings, type SourceFinding } from "@/domain/workspace/findings";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  workspaceFilesKey,
  workspaceGameKey,
  workspaceSourceKey,
  workspaceVersionsKey,
} from "./queryKeys";

const KIND_ICONS: Record<VersionFile["kind"], LucideIcon> = {
  code: FileCode2,
  image: FileImage,
  audio: FileAudio,
  data: FileJson2,
};

export interface CodeViewProps {
  game: GameDetail;
  /** The published version to browse — the workspace only mounts CodeView when one exists. */
  version: CurrentVersion;
  /** Resolution key of the workspace-game query (route param or done id). */
  gameKey: string;
  /** Pre-fill the chat composer ("Ask AI to fix"). */
  onAskAiToFix: (text: string) => void;
  className?: string;
}

/**
 * The real project browser (E14-F5): tree over the ACTUAL published bundle,
 * editor tabs, editable index.html with Save → lint gate → new immutable
 * version, image/audio previews, docked console.
 */
export function CodeView({
  game,
  version,
  gameKey,
  onAskAiToFix,
  className,
}: CodeViewProps): ReactElement {
  const { t, f } = useI18n();
  const versionId = version.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const consoleEntries = useWorkspaceStore((s) => s.consoleEntries);
  const clearConsole = useWorkspaceStore((s) => s.clearConsole);

  const filesQuery = useQuery({
    queryKey: workspaceFilesKey(game.id, versionId),
    queryFn: () => getServices().games.versionFiles(game.id, versionId),
    staleTime: Infinity, // versions are immutable
  });
  const sourceQuery = useQuery({
    queryKey: workspaceSourceKey(game.id, versionId),
    queryFn: () => getServices().games.source(game.id, versionId),
    staleTime: Infinity,
  });

  // Engine adaptation: the bare source endpoint serves exactly ONE editable
  // file (our bundle's is game.js — the /files listing flags it). Any extra
  // flagged file would bind the editor to that same source and save over it,
  // so only the FIRST flagged file keeps its editable bit — and that entry
  // file (not a hardcoded index.html) is the default tab below.
  const files = useMemo(() => {
    const items = filesQuery.data ?? [];
    const entry = items.find((f) => f.editable)?.path;
    return items.map((f) => (f.editable && f.path !== entry ? { ...f, editable: false } : f));
  }, [filesQuery.data]);
  const entryPath = useMemo(
    () => files.find((f) => f.editable)?.path ?? "index.html",
    [files],
  );
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  // B44: non-editable TEXT files (agent modules, data packs) render read-only
  // instead of a lock screen — fetched per path, immutable like the version.
  const viewableFile = useMemo(() => {
    const file = files.find((f) => f.path === activePath) ?? null;
    return file !== null && !file.editable && file.viewable ? file : null;
  }, [files, activePath]);
  const moduleQuery = useQuery({
    queryKey: workspaceSourceKey(game.id, versionId, viewableFile?.path ?? ""),
    queryFn: () => getServices().games.source(game.id, versionId, viewableFile!.path),
    staleTime: Infinity,
    enabled: viewableFile !== null,
  });
  const [treeOpen, setTreeOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [findings, setFindings] = useState<SourceFinding[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // New version ⇒ fresh bundle: drop tabs for vanished paths, reset the draft.
  useEffect(() => {
    setDraft(null);
    setFindings([]);
  }, [versionId]);
  useEffect(() => {
    if (files.length === 0) return;
    setOpenPaths((prev) => {
      const kept = prev.filter((p) => files.some((f) => f.path === p));
      return kept.length > 0 ? kept : [entryPath].filter((p) => files.some((f) => f.path === p));
    });
    setActivePath((prev) =>
      prev !== null && files.some((f) => f.path === prev)
        ? prev
        : files.some((f) => f.path === entryPath)
          ? entryPath
          : (files[0]?.path ?? null),
    );
  }, [files, entryPath, versionId]);

  const openFile = (path: string): void => {
    setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
    setTreeOpen(false);
  };
  const closeTab = (path: string): void => {
    setOpenPaths((prev) => {
      const next = prev.filter((p) => p !== path);
      if (activePath === path) setActivePath(next[next.length - 1] ?? null);
      return next;
    });
  };

  const source = sourceQuery.data;
  const dirty = draft !== null && draft !== source;

  const save = async (): Promise<void> => {
    if (saving || draft === null || !dirty) return;
    setSaving(true);
    setFindings([]);
    try {
      await getServices().games.saveSource(game.id, draft);
      toast({
        title: t.workspace.codeView.savedToast,
        description: t.workspace.codeView.savedToastDescription,
        variant: "success",
      });
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: workspaceGameKey(gameKey) });
      void queryClient.invalidateQueries({ queryKey: workspaceVersionsKey(game.id) });
    } catch (error) {
      if (ApiError.isApiError(error) && error.status === 422) {
        const parsed = parseSourceFindings(error.details);
        setFindings(parsed.length > 0 ? parsed : [{ message: error.message }]);
      } else {
        toast({
          title: t.workspace.codeView.saveFailed,
          description: ApiError.isApiError(error) ? error.message : undefined,
          variant: "error",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleAudio = (file: VersionFile): void => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingPath === file.path) {
      audio.pause();
      setPlayingPath(null);
      return;
    }
    audio.src = file.url;
    void audio.play().catch(() => setPlayingPath(null));
    setPlayingPath(file.path);
  };

  const tabs: EditorTab[] = openPaths
    .map((path) => files.find((f) => f.path === path))
    .filter((f): f is VersionFile => f !== undefined)
    .map((f) => ({
      id: f.path,
      label: f.path.split("/").pop() ?? f.path,
      icon: KIND_ICONS[f.kind],
    }));
  const activeFile = files.find((f) => f.path === activePath) ?? null;
  const treeFiles = files.map((f) => ({ path: f.path, kind: f.kind, editable: f.editable }));
  const errorCount = consoleEntries.filter((e) => e.level === "error").length;

  if (filesQuery.isPending) {
    return (
      <div className={cn("flex h-full flex-col gap-2 p-3", className)}>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-full w-full flex-1" />
      </div>
    );
  }

  if (filesQuery.isError || files.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center p-4", className)}>
        <EmptyState
          icon={CircleAlert}
          title={t.workspace.codeView.filesErrorTitle}
          description={t.workspace.codeView.filesErrorDescription}
          className="w-full max-w-md border-0 bg-transparent"
        />
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} data-testid="code-view">
      {/* Explorer header: mobile tree toggle + save. */}
      <div className="flex items-center gap-2 border-b border-edge-subtle px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen}
          leftIcon={<FolderTree className="size-4 text-warning" aria-hidden />}
        >
          {t.workspace.codeView.files}
        </Button>
        <span className="hidden items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted lg:flex">
          <FolderTree className="size-3.5 text-warning" aria-hidden />
          {t.workspace.codeView.explorer}
        </span>
        <span className="ms-auto" />
        <Button
          variant="gradient-cta"
          size="sm"
          onClick={() => void save()}
          loading={saving}
          disabled={!dirty}
          leftIcon={<FlaskConical className="size-4" aria-hidden />}
        >
          {t.workspace.codeView.save}
        </Button>
      </div>

      {findings.length > 0 && (
        <div className="mx-3 mt-2 flex flex-col gap-1.5 rounded-2xl border border-danger/40 bg-danger/10 p-3" role="alert">
          <p className="flex items-center gap-2 text-sm font-medium text-danger">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            {t.workspace.codeView.reviewBlocked}
          </p>
          <ul className="flex flex-col gap-1 font-mono text-xs text-ink-secondary" dir="ltr">
            {findings.map((finding, i) => (
              <li key={i} className="break-words">
                {finding.line !== undefined && <span className="text-warning">L{finding.line}: </span>}
                {finding.message}
                {finding.rule && <span className="text-ink-muted"> ({finding.rule})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Tree: rail ≥lg, dropdown panel below. */}
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-e border-edge-subtle p-2 lg:block">
          <FileTree
            files={treeFiles}
            selectedPath={activePath}
            onSelect={openFile}
            aria-label={t.ui.filesTree}
          />
        </aside>
        {treeOpen && (
          <div className="absolute inset-x-2 top-1 z-30 max-h-72 overflow-y-auto rounded-2xl border border-edge bg-surface-3 p-2 lg:hidden">
            <FileTree
              files={treeFiles}
              selectedPath={activePath}
              onSelect={openFile}
              aria-label={t.ui.filesTree}
            />
          </div>
        )}

        <section className="flex min-w-0 flex-1 flex-col">
          {tabs.length > 0 && (
            <EditorTabs
              tabs={tabs}
              activeId={activePath}
              onSelect={setActivePath}
              onClose={closeTab}
              labels={{ list: t.ui.openFiles, closeTab: t.ui.closeTab }}
            />
          )}
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {activeFile === null && (
              <EmptyState
                icon={FileCode2}
                title={t.workspace.codeView.openAFile}
                description={t.workspace.codeView.openAFileDescription}
                className="h-full border-0 bg-transparent"
              />
            )}
            {activeFile !== null && activeFile.editable && (
              <>
                {sourceQuery.isPending ? (
                  <Skeleton className="h-full min-h-40 w-full" />
                ) : source === undefined ? (
                  <p className="flex items-center gap-2 p-2 text-sm text-danger">
                    <CircleAlert className="size-4" aria-hidden />
                    {t.workspace.codeView.sourceLoadFailed}
                  </p>
                ) : (
                  <CodePane
                    value={draft ?? source}
                    onChange={setDraft}
                    readOnly={false}
                    filename={activeFile.path}
                    height="100%"
                    labels={{
                      copy: t.ui.copySource,
                      copied: t.common.copied,
                      download: t.ui.downloadSource,
                      readOnly: t.ui.readOnly,
                    }}
                    // Fill the pane: header shrinks, the editor wrapper flexes.
                    className="flex h-full min-h-64 flex-col [&_.cm-theme-none]:min-h-0 [&_.cm-theme-none]:flex-1"
                  />
                )}
              </>
            )}
            {activeFile !== null && !activeFile.editable && activeFile.kind === "image" && (
              <figure className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-edge bg-surface-2 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- CDN asset preview */}
                <img
                  src={activeFile.url}
                  alt={activeFile.path}
                  className="max-h-[70%] max-w-full rounded-xl object-contain"
                />
                <figcaption className="font-mono text-xs text-ink-muted">{activeFile.path}</figcaption>
              </figure>
            )}
            {activeFile !== null && !activeFile.editable && activeFile.kind === "audio" && (
              <AudioAssetRow
                label={activeFile.path}
                playing={playingPath === activeFile.path}
                onToggle={() => toggleAudio(activeFile)}
                detail={activeFile.content_type}
                labels={{
                  play: `${t.common.play} {label}`,
                  pause: `${t.common.pause} {label}`,
                }}
              />
            )}
            {viewableFile !== null && (
              <>
                {moduleQuery.isPending ? (
                  <Skeleton className="h-full min-h-40 w-full" />
                ) : moduleQuery.data === undefined ? (
                  <p className="flex items-center gap-2 p-2 text-sm text-danger">
                    <CircleAlert className="size-4" aria-hidden />
                    {t.workspace.codeView.fileLoadFailed}
                  </p>
                ) : (
                  <CodePane
                    value={moduleQuery.data}
                    readOnly
                    filename={viewableFile.path}
                    height="100%"
                    labels={{
                      copy: t.ui.copySource,
                      copied: t.common.copied,
                      download: t.ui.downloadSource,
                      readOnly: t.ui.readOnly,
                    }}
                    // Fill the pane: header shrinks, the editor wrapper flexes.
                    className="flex h-full min-h-64 flex-col [&_.cm-theme-none]:min-h-0 [&_.cm-theme-none]:flex-1"
                  />
                )}
              </>
            )}
            {activeFile !== null &&
              !activeFile.editable &&
              !activeFile.viewable &&
              activeFile.kind !== "image" &&
              activeFile.kind !== "audio" && (
                <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-edge bg-surface-1 p-6 text-center">
                  <Lock className="size-6 text-ink-muted" aria-hidden />
                  <p className="max-w-sm text-sm text-ink-secondary">
                    {t.workspace.codeView.readOnlyFile.split("{path}")[0]}
                    <span className="font-mono text-ink" dir="ltr">
                      {activeFile.path}
                    </span>
                    {t.workspace.codeView.readOnlyFile.split("{path}")[1]}
                  </p>
                  <a
                    href={activeFile.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="fp-hit inline-flex h-8 items-center gap-1.5 rounded-2xl border border-edge bg-surface-2 px-3 text-sm text-ink-secondary transition-colors duration-150 ease-out hover:text-ink"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    {t.workspace.codeView.openRaw}
                  </a>
                </div>
              )}
          </div>
        </section>
      </div>

      {/* Console dock (E14-F5) — collapsed by default. */}
      <div className="shrink-0 border-t border-edge-subtle">
        <button
          type="button"
          onClick={() => setConsoleOpen((v) => !v)}
          aria-expanded={consoleOpen}
          className={cn(
            "fp-hit flex h-9 w-full items-center gap-2 px-3 text-xs font-medium uppercase tracking-wide",
            "text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-1 hover:text-ink",
          )}
          data-testid="console-dock-toggle"
        >
          <Terminal className="size-3.5 text-cyan" aria-hidden />
          {t.workspace.codeView.console}
          <span className="font-mono tabular-nums">{consoleEntries.length}</span>
          {errorCount > 0 && (
            <span className="rounded-full border border-danger/40 bg-danger/10 px-1.5 font-mono text-[10px] tabular-nums text-danger">
              {f.msg(t.workspace.codeView.errorCount, { count: errorCount })}
            </span>
          )}
          {consoleOpen ? (
            <ChevronDown className="ms-auto size-4" aria-hidden />
          ) : (
            <ChevronUp className="ms-auto size-4" aria-hidden />
          )}
        </button>
        {consoleOpen && (
          <div className="flex h-48 flex-col gap-1 p-2 pt-0">
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearConsole}>
                {t.workspace.codeView.clear}
              </Button>
            </div>
            <ConsolePane
              entries={consoleEntries}
              className="min-h-0 flex-1"
              labels={{
                emptyTitle: t.ui.consoleEmptyTitle,
                emptyDescription: t.ui.consoleEmptyDescription,
                askAiToFix: t.ui.askAiToFix,
                toggleLevel: t.ui.toggleLevelMessages,
              }}
              onAskAiToFix={(entry) =>
                // Agent-directed message: stays English by design (the
                // pipeline's prompts/QA operate in English — E33 doc).
                onAskAiToFix(
                  `My game throws this error — please fix it:\n${entry.message}${entry.stack ? `\n${entry.stack}` : ""}`,
                )
              }
            />
          </div>
        )}
      </div>

      <audio ref={audioRef} onEnded={() => setPlayingPath(null)} className="hidden" />
    </div>
  );
}
