"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { Gamepad2, Loader2, Monitor, RefreshCw, RotateCw, Smartphone, Tablet } from "lucide-react";
import { normalizeOrigin } from "@codply/game-runtime";
import { Button, IconButton, SegmentedControl, EmptyState, cn, useToast } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { deriveGameView } from "@/domain/workspace/gameView";
import { useWorkspaceStore } from "@/stores/workspace";
import { GamePlayerFrame } from "@/components/game/GamePlayerFrame";
import { DevicePreviewFrame } from "./DevicePreviewFrame";
import { useDevicePreview, type DeviceSize } from "./useDevicePreview";

export interface GameViewProps {
  /** Known game id (route param or done event) — required to mount the player. */
  gameId: string | null;
  title: string | null;
  /** Newest published version URL (done event wins over the cached detail). */
  currentPlayUrl: string | null;
  /** A generation/edit job is running (non-terminal). */
  jobRunning: boolean;
  /** Job id — keys the one-time "workspace ready" toast (E14-F4). */
  bootJobId: string | null;
  /** Live label of the running step ("Writing the code…"). */
  currentStepLabel: string | null;
  className?: string;
}

/**
 * The live preview (E14-F4): empty → booting (spinner + live step label +
 * one-time toast) → playing (sandboxed GamePlayer) → stale chip when a new
 * version publishes mid-play. The player mounts an IMMUTABLE version URL and
 * only remounts when the creator opts in (chip / first publish).
 */
export function GameView({
  gameId,
  title,
  currentPlayUrl,
  jobRunning,
  bootJobId,
  currentStepLabel,
  className,
}: GameViewProps): ReactElement {
  const { t } = useI18n();
  const preview = useDevicePreview();
  const mountedPlayUrl = useWorkspaceStore((s) => s.mountedPlayUrl);
  const setMountedPlayUrl = useWorkspaceStore((s) => s.setMountedPlayUrl);
  const pushConsoleEntry = useWorkspaceStore((s) => s.pushConsoleEntry);
  const setCaptureGame = useWorkspaceStore((s) => s.setCaptureGame);
  const { toast } = useToast();
  const toastedJobs = useRef<Set<string>>(new Set());

  const state = deriveGameView({ currentPlayUrl, mountedPlayUrl, jobRunning });

  // First publish auto-mounts — no manual refresh (E14-F4).
  useEffect(() => {
    if (state.autoMountUrl !== null) setMountedPlayUrl(state.autoMountUrl);
  }, [state.autoMountUrl, setMountedPlayUrl]);

  // One-time boot toast per job.
  useEffect(() => {
    if (state.phase !== "booting" || bootJobId === null) return;
    if (toastedJobs.current.has(bootJobId)) return;
    toastedJobs.current.add(bootJobId);
    toast({ title: t.workspace.gameView.bootToast, variant: "info" });
  }, [state.phase, bootJobId, toast, t]);

  if (state.phase === "empty") {
    return (
      <div className={cn("flex h-full items-center justify-center p-4", className)}>
        <EmptyState
          icon={Gamepad2}
          title={t.workspace.gameView.emptyTitle}
          description={t.workspace.gameView.emptyDescription}
          className="w-full max-w-md border-0 bg-transparent"
        />
      </div>
    );
  }

  if (state.phase === "booting" || mountedPlayUrl === null || gameId === null) {
    return (
      <div
        className={cn("flex h-full flex-col items-center justify-center gap-3 p-4 text-center", className)}
        data-testid="game-booting"
      >
        <Loader2 className="size-8 animate-spin text-violet" aria-hidden />
        <p className="fp-pulse text-sm font-medium text-ink" role="status">
          {currentStepLabel ?? t.workspace.gameView.starting}
        </p>
        <p className="text-xs text-ink-muted">{t.workspace.gameView.bootsHere}</p>
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col p-3 sm:p-4", className)}>
      {state.stale && currentPlayUrl !== null && (
        <div className="absolute inset-x-0 top-5 z-20 flex justify-center">
          <Button
            variant="solid"
            size="sm"
            onClick={() => setMountedPlayUrl(currentPlayUrl)}
            leftIcon={<RefreshCw className="size-4 text-cyan" aria-hidden />}
            data-testid="stale-version-chip"
          >
            {t.workspace.gameView.newVersionReady}
          </Button>
        </div>
      )}
      <div className="mb-2 flex shrink-0 items-center justify-center gap-2">
        <SegmentedControl
          aria-label={t.workspace.gameView.devicePreview}
          options={[
            { value: "desktop", label: t.workspace.gameView.deviceDesktop, icon: Monitor },
            { value: "tablet", label: t.workspace.gameView.deviceTablet, icon: Tablet },
            { value: "mobile", label: t.workspace.gameView.deviceMobile, icon: Smartphone },
          ]}
          value={preview.device}
          onChange={(value) => preview.selectDevice(value as DeviceSize)}
        />
        {preview.device !== "desktop" && (
          <IconButton
            icon={RotateCw}
            aria-label={t.workspace.gameView.rotate}
            variant="ghost"
            size="sm"
            onClick={preview.toggleOrientation}
          />
        )}
      </div>
      <div className="min-h-0 flex-1">
        <DevicePreviewFrame viewport={preview.viewport}>
          <GamePlayerFrame
            key={mountedPlayUrl}
            gameId={gameId}
            playUrl={mountedPlayUrl}
            cdnOrigin={normalizeOrigin(mountedPlayUrl) ?? ""}
            title={title ?? undefined}
            playSource="studio"
            onConsole={pushConsoleEntry}
            onCaptureAvailable={setCaptureGame}
            // E42: in a phone/tablet frame the game fills the whole device
            // viewport (no 16/10 letterbox / white gap); desktop keeps the
            // default aspect box.
            fill={preview.viewport !== null}
          />
        </DevicePreviewFrame>
      </div>
    </div>
  );
}
