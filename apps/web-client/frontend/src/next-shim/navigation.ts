// next/navigation shim for ported Codply components running as Django-mounted
// islands. Cross-page navigation is a full browser navigation (Django owns the
// routes); pathname/search hooks are live views over window.location that
// re-render on popstate and on our own history mutations.
import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

// Patch pushState/replaceState once so hooks see island-driven URL changes.
let patched = false;
function ensurePatched(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = ((...args: Parameters<History["pushState"]>) => {
      original(...args);
      notify();
    }) as History["pushState"];
  }
  window.addEventListener("popstate", notify);
}

function subscribe(listener: Listener): () => void {
  ensurePatched();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface AppRouterInstance {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(href: string): void;
}

export function useRouter(): AppRouterInstance {
  const push = useCallback((href: string) => window.location.assign(href), []);
  const replace = useCallback((href: string) => window.location.replace(href), []);
  const back = useCallback(() => window.history.back(), []);
  const forward = useCallback(() => window.history.forward(), []);
  const refresh = useCallback(() => window.location.reload(), []);
  const prefetch = useCallback((_href: string) => {}, []);
  return { push, replace, back, forward, refresh, prefetch };
}

export function usePathname(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => "/",
  );
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  return new URLSearchParams(search);
}

export function redirect(url: string): never {
  window.location.assign(url);
  throw new Error("NEXT_REDIRECT");
}

export function permanentRedirect(url: string): never {
  window.location.assign(url);
  throw new Error("NEXT_REDIRECT");
}

export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
