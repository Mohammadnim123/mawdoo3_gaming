// Sandboxed game player (ported from Codply's game-runtime shell, speaking
// OUR starter-template protocol).
//
// Security model — identical to Codply's: the iframe is sandbox="allow-scripts"
// WITHOUT allow-same-origin, and the bundle loads from the games-CDN foreign
// origin, so generated code runs cross-origin AND sandboxed. Inbound messages
// are trusted only when they come from this exact iframe's contentWindow and
// carry the template envelope {source: "mawdoo3-game", event, data}.

import { useCallback, useEffect, useRef, useState } from "react";

export interface GameMessage {
  event: string;
  data: Record<string, unknown> | null;
}

export interface GamePlayerProps {
  src: string;
  gameOrigin: string;
  title?: string;
  fill?: boolean;
  labels?: { loading?: string; stuck?: string; reload?: string; fullscreen?: string };
  onReady?: () => void;
  onGameOver?: (data: Record<string, unknown>) => void;
  onMessage?: (message: GameMessage) => void;
}

const READY_TIMEOUT_MS = 10_000;

export function GamePlayer({
  src,
  gameOrigin,
  title,
  fill,
  labels = {},
  onReady,
  onGameOver,
  onMessage,
}: GamePlayerProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "stuck">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setStatus("loading");
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "stuck" : current));
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [src, reloadKey]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (gameOrigin && event.origin !== gameOrigin && event.origin !== "null") return;
      const data = event.data as
        | { source?: string; event?: string; data?: Record<string, unknown> | null }
        | null;
      if (!data || data.source !== "mawdoo3-game" || typeof data.event !== "string") return;

      if (data.event === "game_ready") {
        setStatus("ready");
        onReady?.();
      } else if (data.event === "game_over") {
        onGameOver?.(data.data ?? {});
      }
      onMessage?.({ event: data.event, data: data.data ?? null });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [gameOrigin, onGameOver, onMessage, onReady]);

  const requestFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden rounded-2xl border border-[var(--color-edge)] bg-black ${
        fill ? "h-full w-full" : "aspect-[4/3] w-full"
      }`}
    >
      <iframe
        key={reloadKey}
        ref={frameRef}
        src={src}
        title={title || "game"}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow="fullscreen"
        className="h-full w-full border-0"
      />
      {status !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--color-canvas)]/85 text-sm text-[var(--color-ink-secondary)]">
          {status === "loading" ? (
            <>
              <span className="fp-pulse inline-block h-3 w-3 rounded-full bg-[var(--color-violet)]" />
              <span>{labels.loading || "Loading game…"}</span>
            </>
          ) : (
            <>
              <span>{labels.stuck || "The game is taking too long to start."}</span>
              <button
                type="button"
                className="fp-hit rounded-full border border-[var(--color-edge)] px-4 py-1.5 text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                {labels.reload || "Reload"}
              </button>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label={labels.fullscreen || "Fullscreen"}
        title={labels.fullscreen || "Fullscreen"}
        onClick={requestFullscreen}
        className="fp-hit absolute bottom-2 end-2 rounded-full border border-[var(--color-edge)] bg-[var(--color-surface-1)]/80 p-2 text-[var(--color-ink-secondary)] backdrop-blur hover:text-[var(--color-ink)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
    </div>
  );
}
