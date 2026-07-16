/**
 * Owner guard for `/studio/{gameId}` (E14-F1): the workspace is owner-only —
 * non-owners are sent to the public game page, never shown owner UI.
 *
 * Resolution inputs (the service gathers them, this stays pure):
 * - `ownedGame`: the `/me/games` row matching the route param by id
 *   (owner-scoped ⇒ a match proves ownership).
 * - `bySlug`: `GET /games/{param}` result when the param resolved as a SLUG
 *   (covers hand-typed slugs; the API has no public detail-by-id endpoint,
 *   so a non-owner hitting a raw id can only be sent to the feed).
 */

export type WorkspaceGuard =
  | { kind: "owner" }
  | { kind: "redirect"; to: string }
  | { kind: "not-found" };

export interface WorkspaceGuardInput {
  ownedGame: { id: string } | null;
  bySlug: { id: string; slug: string; ownerHandle: string } | null;
  meHandle: string | null;
}

export function resolveWorkspaceGuard(input: WorkspaceGuardInput): WorkspaceGuard {
  if (input.ownedGame !== null) return { kind: "owner" };
  if (input.bySlug !== null) {
    // Param was a slug: normalize owners onto the canonical id route,
    // bounce everyone else to the public game page (no data leak).
    if (input.meHandle !== null && input.bySlug.ownerHandle === input.meHandle) {
      return { kind: "redirect", to: `/studio/${input.bySlug.id}` };
    }
    return { kind: "redirect", to: `/g/${input.bySlug.slug}` };
  }
  return { kind: "not-found" };
}
