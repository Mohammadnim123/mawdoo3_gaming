// Entry: player/overlay islands.
//
// 1. #overlay-island (+ #overlay-props JSON): the TikTok-style vertical
//    overlay feed — feed cards opt in via [data-overlay-open="<slug>"].
// 2. [data-player-island]: upgrades a server-rendered player container into
//    the sandboxed GamePlayer (ready watchdog, fullscreen, error card).

import { createRoot } from "react-dom/client";

import { readMountProps, setCsrfToken } from "./lib/api";
import { OverlayIsland, type OverlayProps } from "./overlay/OverlayIsland";
import { GamePlayer } from "./runtime/GamePlayer";

const overlayMount = document.getElementById("overlay-island");
const overlayProps = readMountProps<OverlayProps>("overlay-props");

if (overlayMount && overlayProps) {
  setCsrfToken(overlayProps.csrfToken);
  createRoot(overlayMount).render(<OverlayIsland {...overlayProps} />);
}

for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-player-island]"))) {
  const src = el.dataset.playerSrc || "";
  const origin = el.dataset.playerOrigin || "";
  if (!src) continue;
  const labels = {
    loading: el.dataset.labelLoading,
    stuck: el.dataset.labelStuck,
    reload: el.dataset.labelReload,
    fullscreen: el.dataset.labelFullscreen,
  };
  el.innerHTML = "";
  createRoot(el).render(
    <GamePlayer src={src} gameOrigin={origin} title={el.dataset.playerTitle} labels={labels} />,
  );
}
