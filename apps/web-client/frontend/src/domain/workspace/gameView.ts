/**
 * Game-view state machine (E14-F4): empty → booting → playing (+ stale chip).
 * Pure — the component owns `mountedPlayUrl` and feeds it back in.
 */

export type GameViewPhase = "empty" | "booting" | "playing";

export interface GameViewState {
  phase: GameViewPhase;
  /** A newer version published while an older one is mounted (show the chip). */
  stale: boolean;
  /** Non-null ⇒ nothing mounted yet: mount this URL now (first publish). */
  autoMountUrl: string | null;
}

export interface GameViewInput {
  /** Newest published version URL known to the workspace (done event > detail). */
  currentPlayUrl: string | null;
  /** URL currently loaded in the sandboxed player (null = none mounted). */
  mountedPlayUrl: string | null;
  /** A generation/edit job is actively running (non-terminal). */
  jobRunning: boolean;
}

export function deriveGameView(input: GameViewInput): GameViewState {
  if (input.currentPlayUrl === null) {
    return {
      phase: input.jobRunning ? "booting" : "empty",
      stale: false,
      autoMountUrl: null,
    };
  }
  if (input.mountedPlayUrl === null) {
    // First publish auto-mounts (E14-F4 "no manual refresh").
    return { phase: "playing", stale: false, autoMountUrl: input.currentPlayUrl };
  }
  return {
    phase: "playing",
    // Mid-play publishes never force a reload — non-blocking chip instead.
    stale: input.mountedPlayUrl !== input.currentPlayUrl,
    autoMountUrl: null,
  };
}
