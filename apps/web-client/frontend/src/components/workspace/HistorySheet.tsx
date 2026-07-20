"use client";

import { useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCog, GitBranch, History, Undo2 } from "lucide-react";
import { ApiError, type GameDetail, type GameVersion } from "@codply/contracts";
import { Button, Dialog, EmptyState, Skeleton, VersionTree, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useWorkspaceStore } from "@/stores/workspace";
import { workspaceGameKey, workspaceVersionsKey } from "./queryKeys";

export interface HistorySheetProps {
  open: boolean;
  onClose: () => void;
  game: GameDetail;
  /** Resolution key of the workspace-game query. */
  gameKey: string;
  /** Switch to the Game tab (preview mounts a version in the player). */
  onShowGame: () => void;
}

/**
 * Everything that ever happened to the project (E14-F9): version tree with
 * preview + one-click rollback (a NEW version — immutability contract), and
 * a full workspace refresh afterwards.
 */
export function HistorySheet({ open, onClose, game, gameKey, onShowGame }: HistorySheetProps): ReactElement {
  const { t, f } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setMountedPlayUrl = useWorkspaceStore((s) => s.setMountedPlayUrl);
  const [rollbackTarget, setRollbackTarget] = useState<GameVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const versionsQuery = useQuery({
    queryKey: workspaceVersionsKey(game.id),
    queryFn: () => getServices().games.versions(game.id),
    enabled: open,
  });
  const versions = versionsQuery.data ?? [];

  const previewVersion = (v: { id: string; play_url: string }): void => {
    setMountedPlayUrl(v.play_url);
    onShowGame();
    onClose();
  };

  const confirmRollback = async (): Promise<void> => {
    if (busy || rollbackTarget === null) return;
    setBusy(true);
    try {
      const result = await getServices().games.rollback(game.id, rollbackTarget.id);
      toast({
        title: f.msg(t.workspace.history.rolledBack, { version: rollbackTarget.version_no }),
        description: t.workspace.history.rolledBackDescription,
        variant: "success",
      });
      setRollbackTarget(null);
      // Refresh the whole workspace: player, files tree, library scope.
      setMountedPlayUrl(result.play_url);
      void queryClient.invalidateQueries({ queryKey: workspaceGameKey(gameKey) });
      void queryClient.invalidateQueries({ queryKey: workspaceVersionsKey(game.id) });
      void queryClient.invalidateQueries({ queryKey: ["workspace-files", game.id] });
      void queryClient.invalidateQueries({ queryKey: ["me-assets"] });
    } catch (error) {
      toast({
        title: t.workspace.history.rollbackFailed,
        description: ApiError.isApiError(error) ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async (): Promise<void> => {
    if (resetting) return;
    setResetting(true);
    try {
      await getServices().games.resetSession(game.id);
      toast({
        title: t.workspace.history.resetDone,
        description: t.workspace.history.resetDoneDescription,
        variant: "success",
      });
      setResetOpen(false);
    } catch (error) {
      toast({
        title: t.workspace.history.resetFailed,
        description: ApiError.isApiError(error) ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && rollbackTarget === null && !resetOpen}
        onClose={onClose}
        title={t.workspace.history.title}
        description={t.workspace.history.description}
        closeLabel={t.ui.closeDialog}
        className="sm:max-w-lg"
      >
        {versionsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {versionsQuery.isSuccess && versions.length === 0 && (
          <EmptyState
            icon={History}
            title={t.workspace.history.empty}
            description={t.workspace.history.emptyDescription}
            className="border-0 bg-transparent"
          />
        )}
        {versions.length > 0 && (
          <VersionTree
            versions={versions}
            currentVersionId={game.current_version?.id ?? ""}
            onPreview={previewVersion}
            onRollback={(v) => {
              const target = versions.find((version) => version.id === v.id);
              if (target) setRollbackTarget(target);
            }}
            busy={busy}
            labels={{
              current: t.ui.current,
              preview: t.ui.preview,
              rollBack: t.ui.rollBack,
              noChangeSummary: t.ui.noChangeSummary,
            }}
            formatWhen={f.dateTime}
          />
        )}

        {/* E22/S12: conversational-memory control lives with the project's past. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-edge bg-surface-2 p-3">
          <BrainCog className="size-4 shrink-0 text-cyan" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-ink-secondary">
            {t.workspace.history.memoryNote}
          </p>
          <Button
            variant="soft"
            size="sm"
            onClick={() => setResetOpen(true)}
            data-testid="reset-memory-button"
          >
            {t.workspace.history.startFreshMemory}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={rollbackTarget !== null}
        onClose={() => setRollbackTarget(null)}
        title={
          rollbackTarget
            ? f.msg(t.workspace.history.rollbackTitle, { version: rollbackTarget.version_no })
            : t.workspace.history.rollbackFallbackTitle
        }
        description={t.workspace.history.rollbackDescription}
        closeLabel={t.ui.closeDialog}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRollbackTarget(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="solid"
              onClick={() => void confirmRollback()}
              loading={busy}
              leftIcon={<Undo2 className="size-4" aria-hidden />}
            >
              {t.workspace.history.rollBack}
            </Button>
          </div>
        }
      >
        {rollbackTarget?.change_summary && (
          <p className="flex items-start gap-2 rounded-2xl border border-edge bg-surface-2 p-3 text-sm text-ink-secondary">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
            {rollbackTarget.change_summary}
          </p>
        )}
      </Dialog>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t.workspace.history.resetTitle}
        description={t.workspace.history.resetDescription}
        closeLabel={t.ui.closeDialog}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="solid"
              onClick={() => void confirmReset()}
              loading={resetting}
              leftIcon={<BrainCog className="size-4" aria-hidden />}
              data-testid="confirm-reset-memory"
            >
              {t.workspace.history.startFresh}
            </Button>
          </div>
        }
      />
    </>
  );
}
