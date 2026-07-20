"use client";

import { useCallback, type ReactElement } from "react";
import { cn } from "@codply/ui";
import { GamePlayer, type BridgeConsolePayload } from "@codply/game-runtime";
import { getServices } from "@/domain/services";
import { getPlaySessionHash } from "@/domain/playSession";

export interface GamePlayerFrameProps {
  gameId: string;
  playUrl: string;
  cdnOrigin: string;
  title?: string;
  /** Attribution for the play ping (`feed` | `direct` | `share` | `create` | `studio`). */
  playSource: string;
  /** Forward runtime console output (studio ConsolePane). */
  onConsole?: (entry: BridgeConsolePayload) => void;
  /** E40: publish a LIVE screenshot fn for the running game (studio composer). */
  onCaptureAvailable?: (capture: (() => Promise<string | null>) | null) => void;
  /** E42: fill the parent (device-preview frame) instead of the 16/10 letterbox. */
  fill?: boolean;
  className?: string;
}

/**
 * App-level wrapper around the sandboxed `<GamePlayer/>`: wires the ≥5s
 * play-tracking ping (anonymous, best-effort) and console forwarding.
 */
export function GamePlayerFrame({
  gameId,
  playUrl,
  cdnOrigin,
  title,
  playSource,
  onConsole,
  onCaptureAvailable,
  fill = false,
  className,
}: GamePlayerFrameProps): ReactElement {
  const handlePlayedFor = useCallback((): void => {
    getServices()
      .games.play(gameId, getPlaySessionHash(), playSource)
      .catch(() => {
        // Play pings are fire-and-forget; never surface failures.
      });
  }, [gameId, playSource]);

  return (
    // GamePlayer styles its own box (border, radius via --fp-player-radius,
    // 16/10 aspect clamped to 70dvh); the wrapper only carries layout classes
    // from the parent — e.g. negative margins for full-bleed mobile. In `fill`
    // mode the wrapper must be full-height so the player can stretch to the
    // device frame (E42).
    <div className={cn(fill && "h-full w-full", className)}>
      <GamePlayer
        versionUrl={playUrl}
        cdnOrigin={cdnOrigin}
        title={title}
        onPlayedFor={handlePlayedFor}
        onConsole={onConsole}
        onCaptureAvailable={onCaptureAvailable}
        fill={fill}
      />
    </div>
  );
}
