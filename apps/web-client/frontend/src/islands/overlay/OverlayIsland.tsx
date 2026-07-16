// TikTok-style overlay player (Codply PlayerOverlay parity): a full-screen
// vertical feed of playable games. Prev/next via swipe (≥60px flick),
// ArrowUp/ArrowDown (capture phase, so a focused game keeps its own keys),
// and on-screen buttons; infinite paging through /feed.json; like/save
// through the existing JSON endpoints; URL kept in sync with history.pushState
// so share/refresh land on the real /g/<slug> page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getJson, postForm } from "../lib/api";
import type { FeedItem, Labels } from "../lib/types";
import { GamePlayer } from "../runtime/GamePlayer";

export interface OverlayProps {
  csrfToken: string;
  locale: string;
  labels: Labels;
  feedUrl: string;
  authenticated: boolean;
}

interface FeedPage {
  items: FeedItem[];
  next_offset: number | null;
}

export function OverlayIsland(props: OverlayProps) {
  const t = props.labels;
  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const touchStartY = useRef<number | null>(null);
  const returnUrl = useRef<string>(window.location.pathname + window.location.search);

  const loadMore = useCallback(() => {
    if (loadingRef.current || nextOffset === null) return;
    loadingRef.current = true;
    const url = `${props.feedUrl}${props.feedUrl.includes("?") ? "&" : "?"}offset=${nextOffset}`;
    getJson<FeedPage>(url)
      .then((page) => {
        setItems((prev) => {
          const seen = new Set(prev.map((item) => item.slug));
          return [...prev, ...page.items.filter((item) => !seen.has(item.slug))];
        });
        setNextOffset(page.next_offset);
      })
      .catch(() => undefined)
      .finally(() => {
        loadingRef.current = false;
      });
  }, [nextOffset, props.feedUrl]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open requests come from feed cards (delegated click on [data-overlay-open]).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-overlay-open]");
      if (!target) return;
      const slug = target.getAttribute("data-overlay-open");
      if (!slug) return;
      event.preventDefault();
      returnUrl.current = window.location.pathname + window.location.search;
      setOpenSlug(slug);
      window.history.pushState({ overlay: slug }, "", `/g/${slug}`);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Back/forward closes or reopens the overlay.
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const slug = (event.state as { overlay?: string } | null)?.overlay ?? null;
      setOpenSlug(slug);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const close = useCallback(() => {
    setOpenSlug(null);
    window.history.pushState({}, "", returnUrl.current);
  }, []);

  const index = useMemo(
    () => items.findIndex((item) => item.slug === openSlug),
    [items, openSlug],
  );
  const current = index >= 0 ? items[index] : null;

  const go = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const target = items[index + delta];
      if (!target) {
        if (delta > 0) loadMore();
        return;
      }
      setOpenSlug(target.slug);
      window.history.replaceState({ overlay: target.slug }, "", `/g/${target.slug}`);
    },
    [index, items, loadMore],
  );

  // Preload the next page when the viewer nears the end of the loaded list.
  useEffect(() => {
    if (index >= 0 && items.length - index <= 3) loadMore();
  }, [index, items.length, loadMore]);

  // Keyboard: capture phase so games keep their own arrow keys once focused.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      document.body.style.overflow = "";
    };
  }, [current, go, close]);

  const toggle = useCallback(
    (kind: "like" | "save", item: FeedItem) => {
      if (!props.authenticated) {
        window.location.href = `/login?next=/g/${item.slug}`;
        return;
      }
      postForm<{ liked?: boolean; saved?: boolean; count: number }>(
        `/games/${item.id}/${kind}`,
        {},
      )
        .then((payload) => {
          setItems((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    like_count: kind === "like" ? payload.count : entry.like_count,
                    save_count: kind === "save" ? payload.count : entry.save_count,
                    viewer: {
                      liked: kind === "like" ? Boolean(payload.liked) : entry.viewer.liked,
                      saved: kind === "save" ? Boolean(payload.saved) : entry.viewer.saved,
                    },
                  }
                : entry,
            ),
          );
        })
        .catch(() => undefined);
    },
    [props.authenticated],
  );

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onTouchStart={(event) => {
        touchStartY.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartY.current;
        touchStartY.current = null;
        const end = event.changedTouches[0]?.clientY;
        if (start === null || end === undefined) return;
        const delta = start - end;
        if (Math.abs(delta) >= 60) go(delta > 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between p-3">
        <button type="button" onClick={close} className="fp-btn fp-btn-ghost fp-btn-sm text-white/90" aria-label={t.overlay_close}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <a href={`/g/${current.slug}`} className="text-sm text-white/70 hover:text-white">
          {t.overlay_open_page}
        </a>
      </div>

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 items-center px-3 pb-3">
        <div className="h-full max-h-[78vh] w-full">
          <GamePlayer
            key={current.slug}
            src={current.play_url}
            gameOrigin={current.game_origin}
            title={current.title}
            fill
            labels={{
              loading: t.player_loading,
              stuck: t.player_stuck,
              reload: t.player_reload,
              fullscreen: t.player_fullscreen,
            }}
          />
        </div>

        {/* Up / down rail */}
        <div className="absolute end-5 top-1/2 flex -translate-y-1/2 flex-col gap-2">
          <button type="button" onClick={() => go(-1)} disabled={index <= 0} className="fp-hit rounded-full bg-white/10 p-3 text-white/90 backdrop-blur hover:bg-white/20 disabled:opacity-30" aria-label={t.overlay_prev}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m18 15-6-6-6 6" /></svg>
          </button>
          <button type="button" onClick={() => go(1)} disabled={index === items.length - 1 && nextOffset === null} className="fp-hit rounded-full bg-white/10 p-3 text-white/90 backdrop-blur hover:bg-white/20 disabled:opacity-30" aria-label={t.overlay_next}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </div>
      </div>

      {/* Footer: creator + social pills */}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pb-5">
        <a href={`/u/${current.owner.handle}`} className="flex min-w-0 items-center gap-2 text-white">
          {current.owner.avatar_url ? (
            <img src={current.owner.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-violet)] text-sm font-semibold text-white">
              {current.owner.display_name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{current.title}</span>
            <span className="block truncate text-xs text-white/60">@{current.owner.handle}</span>
          </span>
        </a>
        <div className="ms-auto flex items-center gap-2">
          <Pill
            active={current.viewer.liked}
            count={current.like_count}
            label={t.action_like}
            onClick={() => toggle("like", current)}
            path="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
          />
          <Pill
            active={current.viewer.saved}
            count={current.save_count}
            label={t.action_save}
            onClick={() => toggle("save", current)}
            path="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"
          />
          <a href={`/g/${current.slug}#comments`} className="fp-hit flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs text-white/90 backdrop-blur hover:bg-white/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
            {current.comment_count}
          </a>
        </div>
      </div>
    </div>
  );
}

function Pill({
  active,
  count,
  label,
  path,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  path: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`fp-hit flex items-center gap-1.5 rounded-full px-3 py-2 text-xs backdrop-blur transition ${
        active ? "bg-[var(--color-violet)] text-white" : "bg-white/10 text-white/90 hover:bg-white/20"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={path} />
      </svg>
      {count}
    </button>
  );
}
