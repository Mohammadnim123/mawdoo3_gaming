"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { clsx } from "clsx";
import { Gamepad2, Keyboard, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import {
  isAllowedOrigin,
  makeControlMessage,
  parseBridgeMessage,
  requestCapture,
  type BridgeConsolePayload,
  type BridgeErrorPayload,
} from "./bridge";
import { usePlayTracking } from "./usePlayTracking";

export interface GamePlayerProps {
  /** Immutable version URL on the CDN origin (`{cdn}/{game}/{version}/index.html`). */
  versionUrl: string;
  /** CDN origin the game is served from; the only accepted postMessage origin. */
  cdnOrigin: string;
  /** Accessible iframe title. */
  title?: string;
  onReady?: () => void;
  onScore?: (score: number) => void;
  onConsole?: (entry: BridgeConsolePayload) => void;
  onError?: (error: BridgeErrorPayload) => void;
  /** Fired once after ≥5s of cumulative visible play (play-count ping). */
  onPlayedFor?: (seconds: number) => void;
  /**
   * E40: publishes a LIVE screenshot fn bound to this frame once the game is
   * ready (`null` before ready / on unmount). The composer calls it to grab
   * EXACTLY what's on screen — the read runs inside the sandboxed frame (the
   * parent can't reach the opaque-origin pixels). Resolves null for games whose
   * shim can't self-capture, so the caller can fall back to a server render.
   */
  onCaptureAvailable?: (capture: (() => Promise<string | null>) | null) => void;
  /** Capture keyboard (focus the game) as soon as it reports ready. */
  autoFocus?: boolean;
  /**
   * E42: fill the parent edge-to-edge instead of the default 16/10 letterbox —
   * used by the device-preview frame so the game occupies the whole phone/tablet
   * viewport (no white gap) exactly as it would on a real device. The parent
   * must supply the height (the device frame does).
   */
  fill?: boolean;
  className?: string;
}

const READY_TIMEOUT_MS = 10_000;

/** Mirrors @codply/ui tokens (game-runtime stays dependency-free of ui). */
const palette = {
  canvas: "#0A0A0F",
  surface: "#12121A",
  surfaceRaised: "#1A1A24",
  border: "#2A2A3A",
  text: "#F4F4F8",
  textMuted: "#A0A0B8",
  violet: "#8B5CF6",
  cyan: "#22D3EE",
} as const;

const styles: Record<string, CSSProperties> = {
  iframe: {
    display: "block",
    width: "100%",
    height: "100%",
    border: "0",
    background: palette.canvas,
  },
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 12,
    background: palette.canvas,
  },
  hintPill: {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 14px",
    borderRadius: 999,
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    color: palette.textMuted,
    fontSize: 13,
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
  fullscreenBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 12,
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    color: palette.textMuted,
    cursor: "pointer",
  },
  reloadBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 20px",
    borderRadius: 14,
    border: "0",
    cursor: "pointer",
    color: "#0A0A0F",
    fontWeight: 600,
    fontSize: 14,
    background: `linear-gradient(135deg, ${palette.violet} 0%, ${palette.cyan} 100%)`,
  },
};

type Phase = "loading" | "ready" | "timeout";

/**
 * Sandboxed game player. Renders the iframe with the exact sandbox attributes
 * mandated by CONVENTIONS §8 (`allow-scripts` only — never `allow-same-origin`)
 * and speaks bridge protocol v1 with strict origin + schema validation.
 *
 * Mobile-first sizing: width 100%, height from the 16/10 aspect ratio but
 * clamped to 70dvh so the actions below never fall offscreen; the parent
 * controls margins (full-bleed allowed) and can round/unround corners via
 * `--fp-player-radius`. Fullscreen uses the Fullscreen API with an iOS
 * fallback (fixed inset-0 100dvh overlay).
 */
export function GamePlayer({
  versionUrl,
  cdnOrigin,
  title,
  onReady,
  onScore,
  onConsole,
  onError,
  onPlayedFor,
  onCaptureAvailable,
  autoFocus = false,
  fill = false,
  className,
}: GamePlayerProps): ReactElement {
  const [phase, setPhase] = useState<Phase>("loading");
  const [captured, setCaptured] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const tracking = usePlayTracking(onPlayedFor);
  const isFullscreen = nativeFullscreen || fallbackFullscreen;

  const postToGame = useCallback((type: "pause" | "resume") => {
    const contentWindow = iframeRef.current?.contentWindow;
    // targetOrigin must be "*": the sandboxed frame's origin is opaque and can
    // never match a concrete origin. Safe — control signals only, and we post
    // exclusively to our own iframe's contentWindow.
    contentWindow?.postMessage(makeControlMessage(type), "*");
  }, []);

  // Ready watchdog: friendly error card if the game never reports ready.
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => setPhase("timeout"), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, reloadCount]);

  // Inbound bridge messages — origin, source and schema all validated.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin, cdnOrigin)) return;
      // Frame identity is the real security check (origin is "null" for the
      // sandboxed opaque origin): only messages from OUR iframe are accepted.
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow || event.source !== contentWindow) return;
      // Legacy adapter: bundles built with engine < 1.1.0 only speak the
      // `mawdoo3-game` envelope. Translate their lifecycle into bridge v1 so
      // older games keep driving this player identically.
      const raw = event.data as
        | { source?: string; event?: string; data?: { score?: number | null; message?: string } }
        | null;
      if (raw && raw.source === "mawdoo3-game" && typeof raw.event === "string") {
        if (raw.event === "game_ready") {
          setPhase("ready");
          tracking.start();
          onReady?.();
          if (autoFocus) {
            setCaptured(true);
            iframeRef.current?.focus();
          }
        } else if (raw.event === "game_over" && typeof raw.data?.score === "number") {
          onScore?.(raw.data.score);
        } else if (raw.event === "game_error") {
          onError?.({ message: String(raw.data?.message ?? "Game error") });
        }
        return;
      }
      const message = parseBridgeMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "ready":
          setPhase("ready");
          tracking.start();
          onReady?.();
          if (autoFocus) {
            setCaptured(true);
            iframeRef.current?.focus();
          }
          break;
        case "console":
          onConsole?.(message.payload);
          break;
        case "score":
          onScore?.(message.payload.score);
          break;
        case "error":
          onError?.(message.payload);
          break;
        case "pause":
        case "resume":
        case "capture":
          break; // parent → game only
        case "capture:result":
          break; // handled by requestCapture()'s own one-shot listener (E40)
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [autoFocus, cdnOrigin, onConsole, onError, onReady, onScore, tracking]);

  // Pause/resume the game (and play tracking) when the tab is hidden.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        postToGame("pause");
        tracking.pause();
      } else {
        postToGame("resume");
        if (phase === "ready") tracking.start();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [phase, postToGame, tracking]);

  // Esc releases keyboard capture.
  useEffect(() => {
    if (!captured) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCaptured(false);
        iframeRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [captured]);

  // Track native fullscreen state (also covers user pressing Esc).
  useEffect(() => {
    const sync = () => setNativeFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Esc exits the iOS-fallback fullscreen overlay.
  useEffect(() => {
    if (!fallbackFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFallbackFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fallbackFullscreen]);

  const capture = useCallback(() => {
    setCaptured(true);
    iframeRef.current?.focus();
  }, []);

  // E40: hand the parent a LIVE screenshot fn bound to THIS frame while the game
  // is ready; null otherwise. requestCapture posts the `capture` control and
  // resolves the frame's `canvas.toDataURL()` reply — the EXACT current frame
  // (preserveDrawingBuffer keeps it). A short timeout means games whose shim
  // can't answer (older versions) fall back to the server render quickly.
  useEffect(() => {
    if (!onCaptureAvailable) return;
    if (phase !== "ready") {
      onCaptureAvailable(null);
      return;
    }
    onCaptureAvailable(() => {
      const frame = iframeRef.current;
      return frame ? requestCapture(frame, cdnOrigin, { timeoutMs: 2000 }) : Promise.resolve(null);
    });
    return () => onCaptureAvailable(null);
  }, [phase, cdnOrigin, onCaptureAvailable]);

  const reload = useCallback(() => {
    setPhase("loading");
    setCaptured(false);
    tracking.reset();
    setReloadCount((n) => n + 1);
  }, [tracking]);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      return;
    }
    if (document.fullscreenElement === root) {
      void document.exitFullscreen?.();
      return;
    }
    if (typeof root.requestFullscreen === "function") {
      root.requestFullscreen().catch(() => setFallbackFullscreen(true));
    } else {
      // iOS Safari: no element fullscreen — expand to a fixed 100dvh overlay.
      setFallbackFullscreen(true);
    }
  }, [fallbackFullscreen]);

  return (
    <div
      ref={rootRef}
      className={clsx(
        "fp-game-player",
        fallbackFullscreen && "fp-game-player--fs",
        fill && "fp-game-player--fill",
        className,
      )}
      style={{ fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)", color: palette.text }}
    >
      <style>{playerCss}</style>
      {phase !== "timeout" && (
        <iframe
          key={reloadCount}
          ref={iframeRef}
          src={versionUrl}
          title={title ?? "Codply game"}
          sandbox="allow-scripts"
          allow="fullscreen; pointer-lock"
          style={styles.iframe}
          tabIndex={0}
        />
      )}

      {phase === "loading" && (
        <div style={styles.overlay} role="status" aria-live="polite" data-testid="player-skeleton">
          <Gamepad2
            size={40}
            color={palette.violet}
            style={{ animation: "fp-player-pulse 1.2s ease-out infinite" }}
            aria-hidden
          />
          <p style={{ margin: 0, fontSize: 14, color: palette.textMuted }}>Loading game…</p>
          <div
            style={{
              width: 160,
              height: 6,
              borderRadius: 999,
              background: palette.surfaceRaised,
              overflow: "hidden",
            }}
            aria-hidden
          >
            <div
              style={{
                width: "40%",
                height: "100%",
                borderRadius: 999,
                background: `linear-gradient(90deg, ${palette.violet}, ${palette.cyan})`,
                animation: "fp-player-slide 1.4s ease-out infinite",
              }}
            />
          </div>
        </div>
      )}

      {phase === "timeout" && (
        <div style={styles.overlay} role="alert" data-testid="player-error">
          <Gamepad2 size={40} color={palette.textMuted} aria-hidden />
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>
            This game is taking too long to load
          </p>
          <p style={{ margin: 0, fontSize: 14, color: palette.textMuted }}>
            It may be a hiccup on our side — a reload usually fixes it.
          </p>
          <button type="button" onClick={reload} style={styles.reloadBtn}>
            <RotateCcw size={16} aria-hidden /> Reload
          </button>
        </div>
      )}

      {phase === "ready" && !captured && (
        <button
          type="button"
          onClick={capture}
          data-testid="capture-overlay"
          aria-label="Click to play — keyboard will be captured, press Escape to release"
          style={{
            position: "absolute",
            inset: 0,
            background: "transparent",
            border: 0,
            cursor: "pointer",
            padding: 0,
          }}
        />
      )}

      {phase === "ready" && (
        <>
          {/* Keyboard hint is meaningless on touch — hidden on coarse pointers. */}
          <div style={styles.hintPill} className="fp-gp-hint" data-testid="capture-hint">
            <Keyboard size={14} aria-hidden />
            {captured ? "Playing — press Esc to release controls" : "Click to play"}
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            data-testid="fullscreen-toggle"
            style={styles.fullscreenBtn}
          >
            {isFullscreen ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Player box model + keyframes. Lives in a <style> tag (not inline styles) so
 * media queries, :fullscreen and the fallback-fullscreen class work, and so
 * parents can override the radius via `--fp-player-radius` for full-bleed
 * mobile layouts.
 */
const playerCss = `
.fp-game-player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  max-height: 70vh;
  max-height: 70dvh;
  background: ${palette.canvas};
  border: 1px solid ${palette.border};
  border-radius: var(--fp-player-radius, 16px);
  overflow: hidden;
  touch-action: manipulation;
}
.fp-game-player:fullscreen {
  aspect-ratio: auto;
  width: 100%;
  height: 100%;
  max-height: none;
  border: 0;
  border-radius: 0;
}
.fp-game-player--fs {
  position: fixed;
  inset: 0;
  z-index: 70;
  width: auto;
  aspect-ratio: auto;
  height: 100vh;
  height: 100dvh;
  max-height: none;
  border: 0;
  border-radius: 0;
}
/* E42: fill the parent (the device-preview frame) edge-to-edge — the game
   occupies the whole phone/tablet viewport, no 16/10 letterbox, no white gap.
   The device frame supplies the bezel + rounding, so drop the player's own. */
.fp-game-player--fill {
  aspect-ratio: auto;
  width: 100%;
  height: 100%;
  max-height: none;
  border: 0;
  border-radius: 0;
}
@media (pointer: coarse) {
  .fp-gp-hint { display: none !important; }
}
@keyframes fp-player-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .55; transform: scale(.92); } }
@keyframes fp-player-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
@media (prefers-reduced-motion: reduce) {
  .fp-game-player * { animation: none !important; }
}
`;
