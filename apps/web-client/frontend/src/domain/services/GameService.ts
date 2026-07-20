import {
  ApiError,
  type FeedItem,
  type FeedParams,
  type GameDetail,
  type MyGame,
  type GameVersion,
  type ChatMessage,
  type Me,
  type MeAssetsParams,
  type MyAsset,
  type PageParams,
  type PaginatedResponse,
  type PatchGameRequest,
  type RemixResponse,
  type RollbackResponse,
  type SaveSourceResponse,
  type SendChatResponse,
  type SessionResetResponse,
  type UpdateMeRequest,
  type VersionFile,
} from "@codply/contracts";
import type { ApiGateway } from "../gateway";
import { resolveWorkspaceGuard } from "../workspace/ownerGuard";

/** `/studio/{gameId}` resolution — see `workspace/ownerGuard.ts` for the rules. */
export type WorkspaceGameResolution =
  | { kind: "owner"; game: GameDetail }
  | { kind: "redirect"; to: string }
  | { kind: "not-found" };

/** All game/feed/account reads and mutations behind one domain service. */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GameService {
  constructor(private readonly gateway: ApiGateway) {}

  feed(params?: FeedParams): Promise<PaginatedResponse<FeedItem>> {
    return this.gateway.client.feed(params);
  }

  gameBySlug(slug: string): Promise<GameDetail> {
    return this.gateway.client.gameBySlug(slug);
  }

  versions(gameId: string): Promise<GameVersion[]> {
    return this.gateway.client.versions(gameId);
  }

  rollback(gameId: string, versionId: string): Promise<RollbackResponse> {
    return this.gateway.client.rollback(gameId, { version_id: versionId });
  }

  patchGame(gameId: string, patch: PatchGameRequest): Promise<GameDetail> {
    return this.gateway.client.patchGame(gameId, patch);
  }

  /** E22/S12: wipe the agent's conversational memory for this game (owner-only). */
  resetSession(gameId: string): Promise<SessionResetResponse> {
    return this.gateway.client.resetGameSession(gameId);
  }

  deleteGame(gameId: string): Promise<void> {
    return this.gateway.client.deleteGame(gameId);
  }

  /** Anonymous play ping (≥5s of play); errors are the caller's to swallow. */
  play(gameId: string, sessionHash: string, source: string): Promise<void> {
    return this.gateway.client.play(gameId, { session_hash: sessionHash, source });
  }

  report(gameId: string, reason: string): Promise<void> {
    return this.gateway.client.report(gameId, { reason });
  }

  chatHistory(gameId: string, params?: PageParams): Promise<PaginatedResponse<ChatMessage>> {
    return this.gateway.client.chatHistory(gameId, params);
  }

  sendChat(gameId: string, message: string, imageBase64?: string): Promise<SendChatResponse> {
    // E40: `message` may be empty when an image rides alone — send it as
    // undefined so the API's "message OR image" refinement passes.
    return this.gateway.client.sendChat(gameId, {
      message: message.length > 0 ? message : undefined,
      image_base64: imageBase64,
    });
  }

  /** E40: server-side screenshot of the current version → PNG data URL. Works
   *  for any game (rendered headless by a worker; nothing baked in required). */
  screenshotGame(gameId: string): Promise<string> {
    return this.gateway.client.screenshotGame(gameId).then((r) => r.image_base64);
  }

  remix(gameId: string, message?: string): Promise<RemixResponse> {
    return this.gateway.client.remix(gameId, message ? { message } : undefined);
  }

  /** B44: `path` reads any bundle TEXT file; omitted = the entry (index.html). */
  source(gameId: string, versionId: string, path?: string): Promise<string> {
    return this.gateway.client.source(gameId, versionId, path).then((r) => r.source_html);
  }

  saveSource(gameId: string, sourceHtml: string): Promise<SaveSourceResponse> {
    return this.gateway.client.saveSource(gameId, { source_html: sourceHtml });
  }

  /** `null` when the visitor is anonymous (401), rethrows anything else. */
  async me(): Promise<Me | null> {
    try {
      return await this.gateway.client.me();
    } catch (error) {
      if (ApiError.isApiError(error) && error.code === "unauthorized") return null;
      throw error;
    }
  }

  updateMe(patch: UpdateMeRequest): Promise<Me> {
    return this.gateway.client.updateMe(patch);
  }

  myGames(params?: PageParams): Promise<PaginatedResponse<MyGame>> {
    return this.gateway.client.myGames(params);
  }

  /** Library: every asset my games have generated (E14-F6). */
  meAssets(params?: MeAssetsParams): Promise<PaginatedResponse<MyAsset>> {
    return this.gateway.client.meAssets(params);
  }

  /** The ACTUAL published bundle of a version (owner-only; E14-F5). */
  versionFiles(gameId: string, versionId: string): Promise<VersionFile[]> {
    return this.gateway.client.versionFiles(gameId, versionId).then((r) => r.items);
  }

  /**
   * Find one of MY games by id (the API has no detail-by-id endpoint):
   * scans `/me/games` pages — owner-scoped, so a match proves ownership.
   */
  async myGameById(gameId: string, maxPages = 5): Promise<MyGame | null> {
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.myGames({ limit: 50, cursor });
      const match = result.items.find((g) => g.id === gameId);
      if (match) return match;
      if (result.next_cursor === null) return null;
      cursor = result.next_cursor;
    }
    return null;
  }

  /**
   * Resolve `/studio/{gameId}` (E14-F1 owner guard): owners get the full
   * detail, non-owners a redirect target, junk params a not-found — without
   * ever exposing owner-only data.
   */
  async resolveWorkspaceGame(param: string, meHandle: string | null): Promise<WorkspaceGameResolution> {
    // v0.4: owner detail comes from GET /me/games/{id} — the public endpoint
    // 404s draft projects (no live page until first publish).
    if (UUID_LIKE.test(param)) {
      try {
        return { kind: "owner", game: await this.gateway.client.meGame(param) };
      } catch (error) {
        if (!(ApiError.isApiError(error) && error.code === "not_found")) throw error;
      }
    }
    let bySlug: GameDetail | null = null;
    try {
      bySlug = await this.gameBySlug(param);
    } catch (error) {
      if (!(ApiError.isApiError(error) && error.code === "not_found")) throw error;
    }
    const guard = resolveWorkspaceGuard({
      ownedGame: null,
      bySlug: bySlug ? { id: bySlug.id, slug: bySlug.slug, ownerHandle: bySlug.owner.handle } : null,
      meHandle,
    });
    // `owner` is impossible here (ownedGame is null) — narrow for the caller.
    return guard.kind === "redirect" ? guard : { kind: "not-found" };
  }

}
