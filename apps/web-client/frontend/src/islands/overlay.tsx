// Legacy entry, kept because vite.config.ts still lists it as an input.
//
// The vertical player overlay now lives in the ported components and ships
// inside the FEED island (src/islands/feed.tsx opens it in place over the
// feed via history.pushState — see PlayerOverlay). No template loads
// overlay.js anymore; this thin re-export keeps the entry building and gives
// any straggler import the real components.
export { PlayerOverlay, OverlayActions, formatCount } from "@/components/feed/PlayerOverlay";
