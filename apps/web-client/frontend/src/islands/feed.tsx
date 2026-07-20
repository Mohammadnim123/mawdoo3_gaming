// Entry: the home feed island (#feed-island).
//
// Mounts the ported FeedScreen and replicates the reference app's intercepted
// `@overlay/(.)g/[slug]` route IN PLACE: a click on any /g/{slug} link inside
// the page (PostCard covers, play pills, trending-rail rows) is soft-navigated
// — history.pushState to /g/{slug} + the full-screen PlayerOverlay over the
// feed. Closing goes history.back() (restores URL + scroll), swipe/arrows
// replaceState through the feedNav context, and popstate (browser back/
// forward) closes/reopens accordingly. Direct loads of /g/{slug} never reach
// this island — Django serves the real game page (SEO/OG untouched).
import { useEffect, type ReactElement } from "react";
import { usePathname } from "next/navigation";
import type { FeedSort } from "@codply/contracts";
import { FeedScreen } from "@/components/feed/FeedScreen";
import { PlayerOverlay } from "@/components/feed/PlayerOverlay";
import { mountIsland } from "./lib/mount";

const GAME_PATH = /^\/g\/([^/]+)\/?$/;

/** The overlay slug when `pathname` is a game path, else null. */
function overlaySlug(pathname: string): string | null {
  const match = GAME_PATH.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const SORTS: readonly FeedSort[] = ["for_you", "trending", "new", "following"];

/** Initial sort/genre from ?sort=&genre= — mirrors the server-rendered home. */
function initialFeedParams(): { sort: FeedSort; genre: string | null } {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get("sort") as FeedSort | null;
  const genre = (params.get("genre") ?? "").trim();
  return {
    sort: sort !== null && SORTS.includes(sort) ? sort : "for_you",
    genre: genre.length > 0 ? genre : null,
  };
}

/**
 * Intercept plain left-clicks on same-origin /g/{slug} anchors and turn them
 * into soft navigations (pushState → overlay). Modified clicks (new tab),
 * downloads and external targets keep the browser default.
 */
function useGameLinkInterception(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor || !anchor.href) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      const slug = overlaySlug(url.pathname);
      if (slug === null) return;
      event.preventDefault();
      // Already showing this game (e.g. the overlay's own title link) — the
      // reference intercepting route re-renders the same overlay; a no-op here.
      if (overlaySlug(window.location.pathname) === slug) return;
      window.history.pushState(window.history.state, "", url.pathname + url.search);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

function FeedIsland({
  initialSort,
  initialGenre,
}: {
  initialSort: FeedSort;
  initialGenre: string | null;
}): ReactElement {
  // The shim's usePathname re-renders on pushState/replaceState/popstate, so
  // the URL alone drives the overlay: click → /g/{slug} → open; swipe →
  // replaceState → new slug; back/close → / → unmount.
  const pathname = usePathname();
  const slug = overlaySlug(pathname);
  useGameLinkInterception();
  return (
    <>
      <FeedScreen initialSort={initialSort} initialGenre={initialGenre} />
      {slug !== null && <PlayerOverlay slug={slug} />}
    </>
  );
}

mountIsland("feed-island", () => {
  const { sort, genre } = initialFeedParams();
  return <FeedIsland initialSort={sort} initialGenre={genre} />;
});
