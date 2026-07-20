// Island mounting helper. Django templates render
//   <div id="{id}"></div>
//   <script id="{id}-props" type="application/json">{ ... }</script>
// and the entry calls `mountIsland(id, render)` — props are parsed from the
// JSON script (no bootstrap request; the session cookie carries auth) and the
// island renders inside the shared AppProviders (query client, theme, i18n,
// toasts).
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "./AppProviders";

/** Parsed JSON props for an island, or null when absent/malformed. */
export function readIslandProps<T>(id: string): T | null {
  const el = document.getElementById(`${id}-props`);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return null;
  }
}

/**
 * Mount an island into `<div id="{id}">` with props from
 * `<script id="{id}-props" type="application/json">`.
 *
 * No-ops when the mount node is missing (island not on this page). A missing
 * or empty props script mounts with `{}` so props-less islands still render;
 * malformed JSON leaves the server-rendered fallback untouched.
 */
export function mountIsland(id: string, render: (props: any) => ReactElement): void {
  const mount = document.getElementById(id);
  if (!mount) return;

  const script = document.getElementById(`${id}-props`);
  let props: unknown = {};
  if (script?.textContent?.trim()) {
    try {
      props = JSON.parse(script.textContent);
    } catch {
      return; // malformed server output — keep the fallback markup
    }
  }

  createRoot(mount).render(<AppProviders>{render(props)}</AppProviders>);
}
