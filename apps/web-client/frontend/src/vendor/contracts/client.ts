import type { z } from "zod";
import { ApiError } from "./error";
import { parseSseStream } from "./sse";
import {
  AnswersResponseSchema,
  AuthProvidersResponseSchema,
  AuthTokenResponseSchema,
  ChatMessageSchema,
  CheckoutResponseSchema,
  ClaimDailyResponseSchema,
  CommentSchema,
  CommentHistoryResponseSchema,
  CreateGenerateResponseSchema,
  CreatorOverviewSchema,
  CreditsResponseSchema,
  FeedItemSchema,
  GameDetailSchema,
  GameOwnerSchema,
  GameSchema,
  JobDraftSchema,
  JobSchema,
  MeSchema,
  NotificationSchema,
  ProfileSchema,
  GameScreenshotResponseSchema,
  RemixResponseSchema,
  RollbackResponseSchema,
  SessionResetResponseSchema,
  SaveSourceResponseSchema,
  SendChatResponseSchema,
  SourceResponseSchema,
  UnreadCountSchema,
  VersionsResponseSchema,
  paginated,
  PayoutsResponseSchema,
  SubscriptionResponseSchema,
  StatusSentResponseSchema,
  type AnswersRequest,
  type AnswersResponse,
  type AuthProvidersResponse,
  type AuthTokenResponse,
  type AvatarUploadRequest,
  type ChatMessage,
  type CheckoutRequest,
  type CheckoutResponse,
  type ClaimDailyResponse,
  type Comment,
  type CreatorOverview,
  type CreditsResponse,
  type PayoutsParams,
  type PayoutsResponse,
  type SubscriptionResponse,
  type CommentsParams,
  type CommentHistoryResponse,
  type CreateCommentRequest,
  type EditCommentRequest,
  type CreateGenerateRequest,
  type CreateGenerateResponse,
  type DevLoginRequest,
  type FeedItem,
  type FeedParams,
  type GameOwner,
  type Notification,
  type Profile,
  type SessionResetResponse,
  type ShareRequest,
  type UnreadCount,
  type Game,
  type GameDetail,
  type GameVersion,
  type Job,
  type JobDraft,
  type MagicLinkRequest,
  MagicLinkRequestResponseSchema,
  type MagicLinkRequestResponse,
  type MagicLinkVerifyRequest,
  type LoginRequest,
  type OAuthCompleteRequest,
  type PasswordForgotRequest,
  type PasswordResetRequest,
  type SignupRequest,
  type StatusSentResponse,
  type VerifyTokenRequest,
  type Me,
  type MeAssetsParams,
  MyAssetSchema,
  type MyAsset,
  MyGameSchema,
  type MyGame,
  type PageParams,
  type PaginatedResponse,
  type PatchGameRequest,
  type PlayRequest,
  type RemixRequest,
  type GameScreenshotResponse,
  type RemixResponse,
  type ReportRequest,
  type RollbackRequest,
  type RollbackResponse,
  type SaveSourceRequest,
  type SaveSourceResponse,
  type SendChatRequest,
  type SendChatResponse,
  type SourceResponse,
  type SseEvent,
  type UpdateMeRequest,
  VersionFilesResponseSchema,
  type VersionFilesResponse,
  SuggestedCreatorsResponseSchema,
  type SuggestedCreator,
} from "./schemas";

export interface ApiClientOptions {
  /** API origin, e.g. `http://localhost:8000`. `/api/v1` is appended by the client. */
  baseUrl: string;
  /** Returns the bearer JWT (or null when anonymous). May be async. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Custom fetch (tests / non-browser runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Sent as `Idempotency-Key` on mutating POSTs. */
  idempotencyKey?: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Resume point — sent as `Last-Event-ID`. */
  lastEventId?: number | string;
}

type Query = Record<string, string | number | boolean | undefined>;

interface InternalRequest {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Query;
  body?: unknown;
  opts?: RequestOptions;
  headers?: Record<string, string>;
}

const feedPage = paginated(FeedItemSchema);
const gamesPage = paginated(GameSchema);
const myGamesPage = paginated(MyGameSchema);
const chatPage = paginated(ChatMessageSchema);
const assetsPage = paginated(MyAssetSchema);
// The API wraps versions in an `{items}` envelope; unwrap to a bare array.
const versionsList = VersionsResponseSchema;
const commentsPage = paginated(CommentSchema);
const ownersPage = paginated(GameOwnerSchema);
const notificationsPage = paginated(NotificationSchema);

/**
 * Typed fetch-based client for the Codply REST API (07_api_contracts.md).
 * Non-2xx responses are parsed into the error envelope and thrown as ApiError.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: ApiClientOptions["getToken"];
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.getToken = options.getToken;
    // Bind the global: browsers throw "Illegal invocation" when window.fetch
    // is called with a foreign `this` (method call via this.fetchImpl).
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  // -- Generation -----------------------------------------------------------

  generate(req: CreateGenerateRequest, opts?: RequestOptions): Promise<CreateGenerateResponse> {
    return this.json(CreateGenerateResponseSchema, {
      method: "POST",
      path: "/generate",
      body: req,
      opts,
    });
  }

  jobSnapshot(jobId: string, opts?: RequestOptions): Promise<Job> {
    return this.json(JobSchema, { method: "GET", path: `/jobs/${enc(jobId)}`, opts });
  }

  answers(jobId: string, req: AnswersRequest, opts?: RequestOptions): Promise<AnswersResponse> {
    return this.json(AnswersResponseSchema, {
      method: "POST",
      path: `/jobs/${enc(jobId)}/answers`,
      body: req,
      opts,
    });
  }

  async cancel(jobId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/jobs/${enc(jobId)}/cancel`, opts });
  }

  /** Live draft source (v0.4): the code as it is being written; null before codegen. */
  jobDraft(jobId: string, opts?: RequestOptions): Promise<JobDraft> {
    return this.json(JobDraftSchema, { method: "GET", path: `/jobs/${enc(jobId)}/draft`, opts });
  }

  /**
   * Open the job SSE stream (`GET /jobs/{id}/stream`) and yield typed events.
   * Pass `lastEventId` to resume; abort via `signal`.
   */
  async streamJob(jobId: string, opts?: StreamOptions): Promise<AsyncGenerator<SseEvent>> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (opts?.lastEventId !== undefined) {
      headers["Last-Event-ID"] = String(opts.lastEventId);
    }
    const response = await this.raw({
      method: "GET",
      path: `/jobs/${enc(jobId)}/stream`,
      headers,
      opts: { signal: opts?.signal },
    });
    return parseSseStream(response);
  }

  // -- Games ----------------------------------------------------------------

  feed(params?: FeedParams, opts?: RequestOptions): Promise<PaginatedResponse<FeedItem>> {
    return this.json(feedPage, {
      method: "GET",
      path: "/games",
      query: {
        sort: params?.sort,
        genre: params?.genre,
        q: params?.q,
        cursor: params?.cursor,
        limit: params?.limit,
      },
      opts,
    });
  }

  gameBySlug(slug: string, opts?: RequestOptions): Promise<GameDetail> {
    return this.json(GameDetailSchema, { method: "GET", path: `/games/${enc(slug)}`, opts });
  }

  /** Owner detail by id (v0.4): full detail incl. drafts with no public page. */
  meGame(gameId: string, opts?: RequestOptions): Promise<GameDetail> {
    return this.json(GameDetailSchema, { method: "GET", path: `/me/games/${enc(gameId)}`, opts });
  }

  versions(gameId: string, opts?: RequestOptions): Promise<GameVersion[]> {
    return this.json(versionsList, {
      method: "GET",
      path: `/games/${enc(gameId)}/versions`,
      opts,
    }).then((r) => r.items);
  }

  rollback(
    gameId: string,
    req: RollbackRequest,
    opts?: RequestOptions,
  ): Promise<RollbackResponse> {
    return this.json(RollbackResponseSchema, {
      method: "POST",
      path: `/games/${enc(gameId)}/rollback`,
      body: req,
      opts,
    });
  }

  /** E22/S12: owner-only "start fresh memory" — the agent's next job starts a
   * clean conversation; files and versions are untouched. */
  resetGameSession(gameId: string, opts?: RequestOptions): Promise<SessionResetResponse> {
    return this.json(SessionResetResponseSchema, {
      method: "POST",
      path: `/games/${enc(gameId)}/session/reset`,
      opts,
    });
  }

  patchGame(gameId: string, req: PatchGameRequest, opts?: RequestOptions): Promise<GameDetail> {
    // Same contract as the GET detail endpoints — the API responds with the
    // serializer-built owner detail, never a bespoke subset (that drift
    // broke posting in prod: the minimal PATCH body failed the schema parse).
    return this.json(GameDetailSchema, {
      method: "PATCH",
      path: `/games/${enc(gameId)}`,
      body: req,
      opts,
    });
  }

  async deleteGame(gameId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "DELETE", path: `/games/${enc(gameId)}`, opts });
  }

  /** Anonymous play ping (204; server dedupes 1/session/30min). */
  async play(gameId: string, req: PlayRequest, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/games/${enc(gameId)}/play`, body: req, opts });
  }

  async report(gameId: string, req: ReportRequest, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/games/${enc(gameId)}/report`, body: req, opts });
  }

  // -- Social (E16, 07 v0.7) --------------------------------------------------

  async like(gameId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/games/${enc(gameId)}/like`, opts });
  }

  async unlike(gameId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "DELETE", path: `/games/${enc(gameId)}/like`, opts });
  }

  async saveGame(gameId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/games/${enc(gameId)}/save`, opts });
  }

  async unsaveGame(gameId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "DELETE", path: `/games/${enc(gameId)}/save`, opts });
  }

  /** Anonymous share ping (204; server dedupes per session). */
  async share(gameId: string, req: ShareRequest, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/games/${enc(gameId)}/share`, body: req, opts });
  }

  comments(
    gameId: string,
    params?: CommentsParams,
    opts?: RequestOptions,
  ): Promise<PaginatedResponse<Comment>> {
    return this.json(commentsPage, {
      method: "GET",
      path: `/games/${enc(gameId)}/comments`,
      query: { parent: params?.parent, cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  createComment(
    gameId: string,
    req: CreateCommentRequest,
    opts?: RequestOptions,
  ): Promise<Comment> {
    return this.json(CommentSchema, {
      method: "POST",
      path: `/games/${enc(gameId)}/comments`,
      body: req,
      opts,
    });
  }

  async deleteComment(commentId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "DELETE", path: `/comments/${enc(commentId)}`, opts });
  }

  /** Edit your own comment (E39) — records the prior body in the edit history
   * and stamps `edited_at`. Responds with the refreshed comment. */
  editComment(
    commentId: string,
    req: EditCommentRequest,
    opts?: RequestOptions,
  ): Promise<Comment> {
    return this.json(CommentSchema, {
      method: "PATCH",
      path: `/comments/${enc(commentId)}`,
      body: req,
      opts,
    });
  }

  /** Toggle a like on a comment (E39; idempotent). */
  async likeComment(commentId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/comments/${enc(commentId)}/like`, opts });
  }

  async unlikeComment(commentId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "DELETE", path: `/comments/${enc(commentId)}/like`, opts });
  }

  /** Public edit history — the comment's prior bodies, newest first (E39). */
  commentHistory(commentId: string, opts?: RequestOptions): Promise<CommentHistoryResponse> {
    return this.json(CommentHistoryResponseSchema, {
      method: "GET",
      path: `/comments/${enc(commentId)}/history`,
      opts,
    });
  }

  async follow(handle: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/users/${enc(handle)}/follow`, opts });
  }

  async unfollow(handle: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "DELETE", path: `/users/${enc(handle)}/follow`, opts });
  }

  profile(handle: string, opts?: RequestOptions): Promise<Profile> {
    return this.json(ProfileSchema, { method: "GET", path: `/users/${enc(handle)}`, opts });
  }

  profileGames(
    handle: string,
    params?: PageParams,
    opts?: RequestOptions,
  ): Promise<PaginatedResponse<FeedItem>> {
    return this.json(feedPage, {
      method: "GET",
      path: `/users/${enc(handle)}/games`,
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  /** Who to follow (E21): most-followed creators the viewer doesn't follow. */
  suggestedCreators(limit = 5, opts?: RequestOptions): Promise<SuggestedCreator[]> {
    return this.json(SuggestedCreatorsResponseSchema, {
      method: "GET",
      path: "/users/suggested",
      query: { limit },
      opts,
    }).then((r) => r.items);
  }

  followers(
    handle: string,
    params?: PageParams,
    opts?: RequestOptions,
  ): Promise<PaginatedResponse<GameOwner>> {
    return this.json(ownersPage, {
      method: "GET",
      path: `/users/${enc(handle)}/followers`,
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  following(
    handle: string,
    params?: PageParams,
    opts?: RequestOptions,
  ): Promise<PaginatedResponse<GameOwner>> {
    return this.json(ownersPage, {
      method: "GET",
      path: `/users/${enc(handle)}/following`,
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  notifications(
    params?: PageParams,
    opts?: RequestOptions,
  ): Promise<PaginatedResponse<Notification>> {
    return this.json(notificationsPage, {
      method: "GET",
      path: "/me/notifications",
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  unreadCount(opts?: RequestOptions): Promise<UnreadCount> {
    return this.json(UnreadCountSchema, {
      method: "GET",
      path: "/me/notifications/unread_count",
      opts,
    });
  }

  async markNotificationsRead(opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: "/me/notifications/read", opts });
  }

  mySaves(params?: PageParams, opts?: RequestOptions): Promise<PaginatedResponse<FeedItem>> {
    return this.json(feedPage, {
      method: "GET",
      path: "/me/saves",
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  /** Games I liked (E36) — same game_card item shape as /me/saves. */
  myLikes(params?: PageParams, opts?: RequestOptions): Promise<PaginatedResponse<FeedItem>> {
    return this.json(feedPage, {
      method: "GET",
      path: "/me/likes",
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  /** Games I played, newest first (E36) — same game_card item shape as /me/saves. */
  myHistory(params?: PageParams, opts?: RequestOptions): Promise<PaginatedResponse<FeedItem>> {
    return this.json(feedPage, {
      method: "GET",
      path: "/me/history",
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  // -- Iterate & remix ------------------------------------------------------

  chatHistory(
    gameId: string,
    params?: PageParams,
    opts?: RequestOptions,
  ): Promise<PaginatedResponse<ChatMessage>> {
    return this.json(chatPage, {
      method: "GET",
      path: `/games/${enc(gameId)}/chat`,
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  sendChat(gameId: string, req: SendChatRequest, opts?: RequestOptions): Promise<SendChatResponse> {
    return this.json(SendChatResponseSchema, {
      method: "POST",
      path: `/games/${enc(gameId)}/chat`,
      body: req,
      opts,
    });
  }

  remix(gameId: string, req?: RemixRequest, opts?: RequestOptions): Promise<RemixResponse> {
    return this.json(RemixResponseSchema, {
      method: "POST",
      path: `/games/${enc(gameId)}/remix`,
      body: req ?? {},
      opts,
    });
  }

  /** E40: server-side screenshot of the game's current version (PNG data URL). */
  screenshotGame(gameId: string, opts?: RequestOptions): Promise<GameScreenshotResponse> {
    return this.json(GameScreenshotResponseSchema, {
      method: "POST",
      path: `/games/${enc(gameId)}/screenshot`,
      body: {},
      opts,
    });
  }

  // -- Code (E10) -----------------------------------------------------------

  /** B44: `path` reads any bundle TEXT file; omitted = the entry (index.html). */
  source(
    gameId: string,
    versionId: string,
    path?: string,
    opts?: RequestOptions,
  ): Promise<SourceResponse> {
    return this.json(SourceResponseSchema, {
      method: "GET",
      path: `/games/${enc(gameId)}/versions/${enc(versionId)}/source`,
      query: { path },
      opts,
    });
  }

  /** The ACTUAL published bundle of a version (owner-only; CONVENTIONS §3 v0.3). */
  versionFiles(
    gameId: string,
    versionId: string,
    opts?: RequestOptions,
  ): Promise<VersionFilesResponse> {
    return this.json(VersionFilesResponseSchema, {
      method: "GET",
      path: `/games/${enc(gameId)}/versions/${enc(versionId)}/files`,
      opts,
    });
  }

  saveSource(
    gameId: string,
    req: SaveSourceRequest,
    opts?: RequestOptions,
  ): Promise<SaveSourceResponse> {
    return this.json(SaveSourceResponseSchema, {
      method: "PUT",
      path: `/games/${enc(gameId)}/source`,
      body: req,
      opts,
    });
  }

  // -- Account --------------------------------------------------------------

  me(opts?: RequestOptions): Promise<Me> {
    return this.json(MeSchema, { method: "GET", path: "/me", opts });
  }

  updateMe(req: UpdateMeRequest, opts?: RequestOptions): Promise<Me> {
    return this.json(MeSchema, { method: "PATCH", path: "/me", body: req, opts });
  }

  /** Upload a new avatar image (E36) — responds with the refreshed Me payload.
   * 400 `validation_error` for bad/oversized/corrupt images. */
  uploadAvatar(req: AvatarUploadRequest, opts?: RequestOptions): Promise<Me> {
    return this.json(MeSchema, { method: "POST", path: "/me/avatar", body: req, opts });
  }

  myGames(params?: PageParams, opts?: RequestOptions): Promise<PaginatedResponse<MyGame>> {
    return this.json(myGamesPage, {
      method: "GET",
      path: "/me/games",
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  /** Library: every asset my games have generated (CONVENTIONS §3 v0.3). */
  meAssets(params?: MeAssetsParams, opts?: RequestOptions): Promise<PaginatedResponse<MyAsset>> {
    return this.json(assetsPage, {
      method: "GET",
      path: "/me/assets",
      query: {
        type: params?.type,
        scope: params?.scope,
        q: params?.q,
        game_id: params?.game_id,
        cursor: params?.cursor,
        limit: params?.limit,
      },
      opts,
    });
  }

  // -- Credits & subscription (E29, CONVENTIONS §3 v0.20) --------------------

  /** Credit balance + the newest-first ledger page. */
  myCredits(params?: PageParams, opts?: RequestOptions): Promise<CreditsResponse> {
    return this.json(CreditsResponseSchema, {
      method: "GET",
      path: "/me/credits",
      query: { cursor: params?.cursor, limit: params?.limit },
      opts,
    });
  }

  /** The free plan's daily grant — 409 `conflict` (details.next_claim_at)
   * when already claimed today; 400 for plans without a daily claim. */
  claimDailyCredits(opts?: RequestOptions): Promise<ClaimDailyResponse> {
    return this.json(ClaimDailyResponseSchema, {
      method: "POST",
      path: "/me/credits/claim-daily",
      opts,
    });
  }

  /** Current plan card + period credit stats. */
  mySubscription(opts?: RequestOptions): Promise<SubscriptionResponse> {
    return this.json(SubscriptionResponseSchema, { method: "GET", path: "/me/subscription", opts });
  }

  /** Start a plan checkout — studio is contact-only (400, `details.contact_only`).
   * In dev the fake provider activates instantly and `url` points back at the app. */
  subscriptionCheckout(req: CheckoutRequest, opts?: RequestOptions): Promise<CheckoutResponse> {
    return this.json(CheckoutResponseSchema, {
      method: "POST",
      path: "/me/subscription/checkout",
      body: req,
      opts,
    });
  }

  // -- Creator dashboard & payouts (E36) --------------------------------------

  /** Lifetime creator stats + earnings + monetization program standing. */
  creatorOverview(opts?: RequestOptions): Promise<CreatorOverview> {
    return this.json(CreatorOverviewSchema, {
      method: "GET",
      path: "/me/creator/overview",
      opts,
    });
  }

  /** Payout balance, gating and request history — the history pages by
   * `cursor` (07: `{items, next_cursor}` convention). */
  creatorPayouts(params?: PayoutsParams, opts?: RequestOptions): Promise<PayoutsResponse> {
    return this.json(PayoutsResponseSchema, {
      method: "GET",
      path: "/me/creator/payouts",
      query: { cursor: params?.cursor },
      opts,
    });
  }

  /** Request a payout of the full balance — 400 below minimum, 409 when one is
   * already pending. Money mutation: pass `opts.idempotencyKey`. Responds with
   * the refreshed payouts payload. */
  requestPayout(opts?: RequestOptions): Promise<PayoutsResponse> {
    return this.json(PayoutsResponseSchema, {
      method: "POST",
      path: "/me/creator/payouts",
      opts,
    });
  }

  // -- Auth -----------------------------------------------------------------

  /** Dev-only login (404 outside dev). */
  authDevLogin(req: DevLoginRequest, opts?: RequestOptions): Promise<AuthTokenResponse> {
    return this.json(AuthTokenResponseSchema, {
      method: "POST",
      path: "/auth/dev-login",
      body: req,
      opts,
    });
  }

  /** Public discovery (E37): password on/off + configured OAuth providers
   * in canonical order (google, discord, apple). No auth required. */
  authProviders(opts?: RequestOptions): Promise<AuthProvidersResponse> {
    return this.json(AuthProvidersResponseSchema, {
      method: "GET",
      path: "/auth/providers",
      opts,
    });
  }

  /** Email+password signup (E37) — enumeration-safe: ALWAYS `{status:"sent"}`.
   * The password only activates when the emailed verification link is clicked. */
  signup(req: SignupRequest, opts?: RequestOptions): Promise<StatusSentResponse> {
    return this.json(StatusSentResponseSchema, {
      method: "POST",
      path: "/auth/signup",
      body: req,
      opts,
    });
  }

  /** Email+password login (E37) — 401 `unauthorized` with ONE generic message
   * for every failure mode (unknown email / bad password / no active password);
   * banned accounts get 403. */
  loginPassword(req: LoginRequest, opts?: RequestOptions): Promise<AuthTokenResponse> {
    return this.json(AuthTokenResponseSchema, {
      method: "POST",
      path: "/auth/login",
      body: req,
      opts,
    });
  }

  /** Redeem an emailed login token (E37): dispatches on the token's purpose —
   * magic_link (existing semantics) or signup (activates the pending password
   * + marks the email verified). 401 on bad/expired/used tokens. */
  verifyLoginToken(req: VerifyTokenRequest, opts?: RequestOptions): Promise<AuthTokenResponse> {
    return this.json(AuthTokenResponseSchema, {
      method: "POST",
      path: "/auth/verify",
      body: req,
      opts,
    });
  }

  /** Request a password-reset email (E37) — enumeration-safe: ALWAYS `{status:"sent"}`. */
  forgotPassword(req: PasswordForgotRequest, opts?: RequestOptions): Promise<StatusSentResponse> {
    return this.json(StatusSentResponseSchema, {
      method: "POST",
      path: "/auth/password/forgot",
      body: req,
      opts,
    });
  }

  /** Redeem a password-reset token (E37) — responds `{token, user}` and bumps
   * the auth epoch (revokes every older JWT); 401 on bad/expired/used token. */
  resetPassword(req: PasswordResetRequest, opts?: RequestOptions): Promise<AuthTokenResponse> {
    return this.json(AuthTokenResponseSchema, {
      method: "POST",
      path: "/auth/password/reset",
      body: req,
      opts,
    });
  }

  /** Exchange the one-time login code minted by the OAuth callback (E37) for
   * `{token, user}` — 401 invalid/expired code (60 s TTL, single-use). */
  oauthComplete(req: OAuthCompleteRequest, opts?: RequestOptions): Promise<AuthTokenResponse> {
    return this.json(AuthTokenResponseSchema, {
      method: "POST",
      path: "/auth/oauth/complete",
      body: req,
      opts,
    });
  }

  magicLinkRequest(
    req: MagicLinkRequest,
    opts?: RequestOptions,
  ): Promise<MagicLinkRequestResponse> {
    return this.json(MagicLinkRequestResponseSchema, {
      method: "POST",
      path: "/auth/magic-link/request",
      body: req,
      opts,
    });
  }

  magicLinkVerify(req: MagicLinkVerifyRequest, opts?: RequestOptions): Promise<AuthTokenResponse> {
    return this.json(AuthTokenResponseSchema, {
      method: "POST",
      path: "/auth/magic-link/verify",
      body: req,
      opts,
    });
  }

  // -- Admin (role=admin) ---------------------------------------------------

  adminJob(jobId: string, opts?: RequestOptions): Promise<Job> {
    return this.json(JobSchema, { method: "GET", path: `/admin/jobs/${enc(jobId)}`, opts });
  }

  async adminTakedown(gameId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/admin/games/${enc(gameId)}/takedown`, opts });
  }

  async adminBanUser(userId: string, opts?: RequestOptions): Promise<void> {
    await this.void_({ method: "POST", path: `/admin/users/${enc(userId)}/ban`, opts });
  }

  // -- Internals ------------------------------------------------------------

  private async json<S extends z.ZodTypeAny>(schema: S, req: InternalRequest): Promise<z.infer<S>> {
    const response = await this.raw(req);
    if (response.status === 204) {
      throw new ApiError("server_error", "Expected a response body but got 204", {}, 204);
    }
    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        "server_error",
        `Response did not match the expected contract for ${req.method} ${req.path}`,
        { issues: parsed.error.issues },
        response.status,
      );
    }
    return parsed.data as z.infer<S>;
  }

  private async void_(req: InternalRequest): Promise<void> {
    await this.raw(req);
  }

  private async raw(req: InternalRequest): Promise<Response> {
    const url = new URL(`${this.baseUrl}/api/v1${req.path}`);
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { ...req.headers };
    const token = await this.getToken?.();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (req.body !== undefined) headers["Content-Type"] = "application/json";
    if (req.opts?.idempotencyKey) headers["Idempotency-Key"] = req.opts.idempotencyKey;

    const response = await this.fetchImpl(url.toString(), {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: req.opts?.signal,
    });
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // non-JSON error body (proxy, HTML) → generic envelope below
      }
      throw ApiError.fromResponse(response.status, body);
    }
    return response;
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Path of the OAuth start endpoint (E37):
 * `/api/v1/auth/oauth/{provider}/start[?next=...]`.
 *
 * The endpoint answers with a 302 to the provider's authorization URL, so it
 * MUST be reached by top-level NAVIGATION (`location.assign` / an `<a href>`),
 * never fetch/XHR — a fetch would follow the redirect cross-origin and die on
 * CORS instead of sending the user to the provider.
 */
export function oauthStartPath(provider: string, next?: string): string {
  const base = `/api/v1/auth/oauth/${enc(provider)}/start`;
  return next === undefined ? base : `${base}?next=${enc(next)}`;
}
