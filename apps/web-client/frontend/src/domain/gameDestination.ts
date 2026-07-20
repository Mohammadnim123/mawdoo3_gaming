/**
 * Where a game card (or link) should send the viewer.
 *
 * v0.4 draft projects exist from build-accept — including ones whose first
 * build FAILED — so owner-scoped lists carry unpublished rows. Those have no
 * public `/g/{slug}` page (it 404s until the first publish); the owner's
 * work lives in the studio, where conversational recovery continues from
 * the draft. Non-owners get no link at all: existence stays private.
 */

export interface GameDestinationGame {
  id: string;
  slug: string;
  /** Wire game status — "live"/"removed" only exist after a first publish. */
  status: string;
  /** Published play URL — null until the first publish (`/me/games` rows). */
  play_url?: string | null;
}

export type GameDestination =
  | { kind: "play"; href: string }
  | { kind: "studio"; href: string }
  | { kind: null; href: null };

/** True once the game has a published version (a public page exists). */
export function isPublishedGame(
  game: Pick<GameDestinationGame, "status" | "play_url">,
): boolean {
  // Either signal proves a publish happened: `play_url` mirrors
  // `current_version_id` (set at first publish), and the status machine only
  // reaches "live" (or moderation's "removed") through that same publish.
  return Boolean(game.play_url) || game.status === "live" || game.status === "removed";
}

export function gameDestination(game: GameDestinationGame, isOwner: boolean): GameDestination {
  if (isPublishedGame(game)) return { kind: "play", href: `/g/${game.slug}` };
  if (isOwner) return { kind: "studio", href: `/studio/${game.id}` };
  return { kind: null, href: null };
}
