import type { MeAssetsParams } from "@codply/contracts";

/**
 * Library view state → `GET /me/assets` query params (E14-F6). Pure — the
 * component owns the UI state and the infinite query supplies the cursor.
 */

export type LibrarySegment = "images" | "audio";
export type LibrarySource = "project" | "all";
export type LibraryChip = "all" | "unused";

export interface LibraryFilterState {
  segment: LibrarySegment;
  source: LibrarySource;
  chip: LibraryChip;
  /** Raw (already debounced) search text; blank ⇒ no `q` param. */
  search: string;
  /** Current workspace game (null on a brand-new project). */
  gameId: string | null;
}

export const LIBRARY_PAGE_SIZE = 40;

export function buildLibraryParams(
  state: LibraryFilterState,
  cursor?: string,
  limit: number = LIBRARY_PAGE_SIZE,
): MeAssetsParams {
  const q = state.search.trim();
  return {
    type: state.segment === "images" ? "image" : "audio",
    scope: state.chip === "unused" ? "unused" : "all",
    ...(q !== "" ? { q } : {}),
    // "This project" only means something once the project exists.
    ...(state.source === "project" && state.gameId !== null ? { game_id: state.gameId } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    limit,
  };
}
