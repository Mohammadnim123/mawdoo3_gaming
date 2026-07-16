// Entry: the global chrome island — hydrates the server-rendered top bar's
// interactive slots and owns the sitewide /g/{slug} player-overlay
// interception on pages that don't mount the feed island.
//
//   #chrome-search  → HeaderSearch (combobox + mobile sheet), replacing the
//                     SSR search form (identical first paint).
//   #chrome-actions → NotificationBell + AccountMenu (or the logged-out
//                     LanguageToggle + Log-in pair). The server serializes
//                     the viewer (`chrome_props`) into the props script and
//                     we seed the query cache with it, so the FIRST React
//                     render already matches the SSR markup — no flash.
//   #chrome-overlay → document-level interception of same-origin /g/{slug}
//                     clicks → pushState + PlayerOverlay in place (the
//                     reference `@overlay/(.)g/[slug]` route). The home page
//                     feed island owns this itself, so we skip it there —
//                     that is also what makes double-handling impossible.
import { useEffect, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import type { FeedItem, Me } from "@codply/contracts";
import { AccountMenu } from "@/components/nav/TopBar";
import { NotificationBell } from "@/components/social/NotificationBell";
import { HeaderSearch } from "@/components/search/HeaderSearch";
import { PlayerOverlay } from "@/components/feed/PlayerOverlay";
import { ME_QUERY_KEY } from "@/domain/hooks/useMe";
import { getServices } from "@/domain/services";
import { useFeedNav } from "@/stores/feedNav";
import { mountIsland } from "./lib/mount";

const GAME_PATH = /^\/g\/([^/]+)\/?$/;

/** The overlay slug when `pathname` is a game path, else null. */
function overlaySlug(pathname: string): string | null {
  const match = GAME_PATH.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

interface ChromeProps {
  me: Me | null;
  unread: number;
}

/**
 * Bell + account menu with the server-known viewer seeded into the query
 * cache BEFORE the children's useMe/useUnreadCount mount — the first render
 * is the settled state (avatar / logged-out actions), pixel-identical to the
 * SSR slot content, so hydration is invisible.
 */
function ChromeActions({ me, unread }: ChromeProps): ReactElement {
  const queryClient = useQueryClient();
  useState(() => {
    queryClient.setQueryData(ME_QUERY_KEY, me);
    if (me) queryClient.setQueryData(["unread-count"], { count: unread });
    return null;
  });
  return (
    <>
      <NotificationBell />
      <AccountMenu />
    </>
  );
}

/**
 * Global overlay host (pages without the feed island): a plain left click on
 * a same-origin /g/{slug} anchor soft-navigates — pushState + the full-screen
 * PlayerOverlay over the current page. Close = history.back() (PlayerOverlay
 * does this), which pops back to the page the viewer was on; we watch the
 * pathname and unmount when it returns there. Mirrors src/islands/feed.tsx's
 * interception guards exactly.
 */
function ChromeOverlayHost(): ReactElement | null {
  const pathname = usePathname();
  // The pathname the viewer was on when the overlay opened; null = closed.
  const [returnPath, setReturnPath] = useState<string | null>(null);

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
      // Already on this game's page/overlay — a no-op, like the reference.
      if (overlaySlug(window.location.pathname) === slug) return;
      const from = window.location.pathname;
      window.history.pushState(window.history.state, "", url.pathname + url.search);
      setReturnPath((current) => current ?? from);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const slug = returnPath !== null ? overlaySlug(pathname) : null;

  // Back (or PlayerOverlay's close) popped to the origin page → unmount.
  useEffect(() => {
    if (returnPath !== null && (pathname === returnPath || overlaySlug(pathname) === null)) {
      setReturnPath(null);
    }
  }, [pathname, returnPath]);

  // Forward-navigation to a /g/ entry while closed: this page can't render
  // that game in place (no overlay context) — load the real game page.
  useEffect(() => {
    const onPopState = (): void => {
      if (returnPath === null && overlaySlug(window.location.pathname) !== null) {
        window.location.reload();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [returnPath]);

  // Direct-open context: when the browsing feed didn't populate feedNav,
  // seed a single-item context from the game itself (prev/next stay empty).
  useEffect(() => {
    if (slug === null) return;
    if (useFeedNav.getState().slugs.length > 0) return;
    let cancelled = false;
    getServices()
      .games.gameBySlug(slug)
      .then((game) => {
        if (cancelled || useFeedNav.getState().slugs.length > 0) return;
        useFeedNav.getState().setContext(`chrome:${slug}`, [game as unknown as FeedItem], null);
      })
      .catch(() => {
        // The overlay fetches (and reports) the game itself — nothing to do.
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return slug !== null ? <PlayerOverlay slug={slug} /> : null;
}

mountIsland("chrome-search", () => <HeaderSearch />);

mountIsland("chrome-actions", (props: Partial<ChromeProps> | null) => (
  // Props come from the page-level #chrome-actions-props script.
  <ChromeActions me={props?.me ?? null} unread={props?.unread ?? 0} />
));

// The feed island owns interception + overlay on the home page (it renders
// the overlay from the URL alone). Mounting there too would double-render.
if (!document.getElementById("feed-island")) {
  mountIsland("chrome-overlay", () => <ChromeOverlayHost />);
}
