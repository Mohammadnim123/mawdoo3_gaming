import { z } from "zod";

// ---------------------------------------------------------------------------
// Error envelope (CONVENTIONS §3 / 07 §top)
// ---------------------------------------------------------------------------

export const ErrorCodeSchema = z.enum([
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "quota_exceeded",
  // E29 (HTTP 402): balance below the admission floor — details carry
  // {balance, required, daily_claim_credits, upgrade_plans}.
  "credits_exhausted",
  "moderation_blocked",
  "conflict",
  "server_error",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).default({}),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Pagination helper (07: {items[], next_cursor})
// ---------------------------------------------------------------------------

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
}
export type PaginatedResponse<T> = { items: T[]; next_cursor: string | null };

// ---------------------------------------------------------------------------
// Users & account
// ---------------------------------------------------------------------------

export const UserRoleSchema = z.enum(["user", "admin"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  handle: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullish().default(null),
  email: z.string().nullish(),
  role: UserRoleSchema.default("user"),
  created_at: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const QuotaSchema = z.object({
  daily_limit: z.number().int(),
  used_today: z.number().int(),
});
export type Quota = z.infer<typeof QuotaSchema>;

/** GET /me → profile + quota (+ M2 credits_cents). */
export const MeSchema = UserSchema.extend({
  quota: QuotaSchema,
  credits_cents: z.number().int().nullish(),
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateMeRequestSchema = z.object({
  display_name: z.string().min(1).max(80).optional(),
  avatar_url: z.string().nullable().optional(),
  bio: z.string().max(200).optional(),
});
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

/** POST /me/avatar body (E36) — the response is the flat Me payload. */
export const AvatarUploadRequestSchema = z.object({ data_base64: z.string().min(8) });
export type AvatarUploadRequest = z.infer<typeof AvatarUploadRequestSchema>;

export const AuthTokenResponseSchema = z.object({
  token: z.string(),
  user: UserSchema,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

export const DevLoginRequestSchema = z.object({ email: z.string().email() });
export type DevLoginRequest = z.infer<typeof DevLoginRequestSchema>;

export const MagicLinkRequestSchema = z.object({ email: z.string().email() });
export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkRequestResponseSchema = z.object({
  // Present while the platform has no mailer (v0.1 inline mode) or in dev.
  code: z.string().optional(),
  dev_link: z.string().optional(),
});
export type MagicLinkRequestResponse = z.infer<typeof MagicLinkRequestResponseSchema>;

export const MagicLinkVerifyRequestSchema = z.object({ token: z.string() });
export type MagicLinkVerifyRequest = z.infer<typeof MagicLinkVerifyRequestSchema>;

// ---------------------------------------------------------------------------
// Native auth: passwords + OAuth (E37)
// ---------------------------------------------------------------------------

/** GET /auth/providers — public discovery: whether password auth is on and
 * which OAuth providers are configured, in canonical order
 * (google, discord, apple). The wire stays an OPEN string array — a new
 * provider must never break the login screen. */
export const AuthProvidersResponseSchema = z.object({
  password: z.boolean(),
  providers: z.array(z.string()),
  // When true, no email verification is required — the login screen signs the
  // user straight in after signup instead of showing a "check your email"
  // panel. Optional so older API builds still parse (defaults to off).
  skip_email_verification: z.boolean().optional(),
});
export type AuthProvidersResponse = z.infer<typeof AuthProvidersResponseSchema>;

/** POST /auth/signup — enumeration-safe: ALWAYS answers {"status":"sent"}.
 * Password policy is length only (NIST): 8..128 chars, no composition rules. */
export const SignupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

/** POST /auth/login — 401 `unauthorized` with ONE generic message regardless
 * of which part was wrong (unknown email / bad password / no active password). */
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** The enumeration-safe "we (maybe) sent an email" acknowledgement —
 * signup, password/forgot (and magic-link/request) always answer this. */
export const StatusSentResponseSchema = z.object({ status: z.literal("sent") });
export type StatusSentResponse = z.infer<typeof StatusSentResponseSchema>;

/** POST /auth/verify — one emailed login token (purpose: magic_link | signup);
 * responds {token, user} or 401 on bad/expired/used tokens. */
export const VerifyTokenRequestSchema = z.object({ token: z.string().min(16).max(128) });
export type VerifyTokenRequest = z.infer<typeof VerifyTokenRequestSchema>;

/** POST /auth/password/forgot — enumeration-safe: ALWAYS {"status":"sent"}. */
export const PasswordForgotRequestSchema = z.object({ email: z.string().email() });
export type PasswordForgotRequest = z.infer<typeof PasswordForgotRequestSchema>;

/** POST /auth/password/reset — responds {token, user} and bumps the user's
 * auth epoch (every older JWT dies); 401 on bad/expired/used token. */
export const PasswordResetRequestSchema = z.object({
  token: z.string().min(16).max(128),
  password: z.string().min(8).max(128),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

/** POST /auth/oauth/complete — exchanges the one-time login code minted by the
 * OAuth callback (never a JWT in a URL) for {token, user}; 401 invalid/expired. */
export const OAuthCompleteRequestSchema = z.object({ code: z.string().min(8).max(128) });
export type OAuthCompleteRequest = z.infer<typeof OAuthCompleteRequestSchema>;

// ---------------------------------------------------------------------------
// Credits & subscription (E29, CONVENTIONS §3 v0.20)
// ---------------------------------------------------------------------------

/**
 * Ledger kinds the backend writes today (06 v0.20). The wire stays an OPEN
 * string (like activity kinds, E26): a new grant/spend kind must never break
 * the credits page — UIs style this set and fall back for anything else.
 */
export const KNOWN_CREDIT_LEDGER_KINDS = [
  "grant_initial",
  "grant_daily",
  "grant_plan_reset",
  "spend_job",
  "refund_job",
  "admin_adjust",
] as const;
export type KnownCreditLedgerKind = (typeof KNOWN_CREDIT_LEDGER_KINDS)[number];

/** One `/me/credits` ledger row: + grants / − spends; balance = SUM(delta). */
export const CreditLedgerEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  delta: z.number().int(),
  note: z.string().nullable(),
  job_id: z.string().nullable(),
  created_at: z.string(),
});
export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntrySchema>;

/** GET /me/credits → balance + the newest-first ledger page. */
export const CreditsResponseSchema = z.object({
  balance: z.number().int(),
  items: z.array(CreditLedgerEntrySchema),
  next_cursor: z.string().nullable(),
});
export type CreditsResponse = z.infer<typeof CreditsResponseSchema>;

/**
 * POST /me/credits/claim-daily → the free plan's daily grant. Already claimed
 * → 409 `conflict` with `details.next_claim_at`; plans without a daily claim
 * → 400 `validation_error`.
 */
export const ClaimDailyResponseSchema = z.object({
  granted: z.number().int(),
  balance: z.number().int(),
  next_claim_at: z.string(),
});
export type ClaimDailyResponse = z.infer<typeof ClaimDailyResponseSchema>;

export const SubscriptionIntervalSchema = z.enum(["monthly", "yearly"]);
export type SubscriptionInterval = z.infer<typeof SubscriptionIntervalSchema>;

/** Plan card — prices/features come straight from the server's plan catalog. */
export const SubscriptionPlanSchema = z.object({
  key: z.string(),
  name: z.string(),
  monthly_price_cents: z.number().int(),
  yearly_price_cents: z.number().int(),
  /** Feature KEYS (e.g. "daily_claim") — display copy is the client's. */
  features: z.array(z.string()),
});
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;

/** GET /me/subscription → current plan + period credit stats. */
export const SubscriptionResponseSchema = z.object({
  plan: SubscriptionPlanSchema,
  interval: SubscriptionIntervalSchema,
  /** Open string ("active" today) — future provider states must not break clients. */
  status: z.string(),
  period_end: z.string(),
  credits: z.object({
    remaining: z.number().int(),
    used_this_period: z.number().int(),
    period_total: z.number().int(),
  }),
  /** False when no payment adapter is wired — the UI hides self-serve checkout
   * instead of letting the upgrade button 503 (audit 2026-07). Defaulted so an
   * older API without the field reads as available. */
  checkout_available: z.boolean().default(true),
});
export type SubscriptionResponse = z.infer<typeof SubscriptionResponseSchema>;

/** POST /me/subscription/checkout — studio is contact-only (400, `details.contact_only`). */
export const CheckoutRequestSchema = z.object({
  plan: z.string().min(1),
  interval: SubscriptionIntervalSchema.default("monthly"),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/** Checkout redirect target. The dev fake provider activates the plan
 * immediately and points back at `/account/billing?checkout=success…`. */
export const CheckoutResponseSchema = z.object({ url: z.string() });
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

// ── Creator dashboard & payouts (E36) ──

/** Program thresholds + the creator's standing against them. */
export const MonetizationSchema = z.object({
  cpm_min_cents: z.number().int(),
  cpm_max_cents: z.number().int(),
  max_paid_plays: z.number().int(),
  min_live_games: z.number().int(),
  min_payout_cents: z.number().int(),
  free_daily_generations: z.number().int(),
  eligible: z.boolean(),
  live_games: z.number().int(),
});
export type Monetization = z.infer<typeof MonetizationSchema>;

export const CreatorStatsSchema = z.object({
  followers: z.number().int(),
  following: z.number().int(),
  plays: z.number().int(),
  likes: z.number().int(),
  remixes: z.number().int(),
  saves: z.number().int(),
  live_games: z.number().int(),
});
export type CreatorStats = z.infer<typeof CreatorStatsSchema>;

/** GET /me/creator/overview → lifetime stats + earnings + program standing. */
export const CreatorOverviewSchema = z.object({
  stats: CreatorStatsSchema,
  earnings: z.object({
    total_earned_cents: z.number().int(),
    balance_cents: z.number().int(),
  }),
  monetization: MonetizationSchema,
});
export type CreatorOverview = z.infer<typeof CreatorOverviewSchema>;

/** One payout request row. `status` stays an OPEN string ("pending"/"paid"/
 * "rejected" today) — future provider states must not break clients, same
 * convention as SubscriptionResponse. */
export const PayoutSchema = z.object({
  id: z.string(),
  amount_cents: z.number().int(),
  status: z.string(),
  created_at: z.string(),
});
export type Payout = z.infer<typeof PayoutSchema>;

/** GET/POST /me/creator/payouts → balance, gating, and the request history.
 * The history pages by cursor (07: `next_cursor`, always present); balance,
 * gating and `pending` ride every page and are read from the head page. */
export const PayoutsResponseSchema = z.object({
  balance_cents: z.number().int(),
  min_payout_cents: z.number().int(),
  can_request: z.boolean(),
  pending: PayoutSchema.nullable(),
  items: PayoutSchema.array(),
  next_cursor: z.string().nullable(),
  monetization: MonetizationSchema,
});
export type PayoutsResponse = z.infer<typeof PayoutsResponseSchema>;

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export const GameVisibilitySchema = z.enum(["public", "unlisted", "private"]);
export type GameVisibility = z.infer<typeof GameVisibilitySchema>;

export const GameOwnerSchema = z.object({
  handle: z.string(),
  // Users who never set a display name come back as explicit null (06: nullable column).
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});
export type GameOwner = z.infer<typeof GameOwnerSchema>;

/** Who-to-follow rail entry (E21). */
export const SuggestedCreatorSchema = GameOwnerSchema.extend({
  follower_count: z.number().int(),
});
export type SuggestedCreator = z.infer<typeof SuggestedCreatorSchema>;

/** A row in a followers/following list: the creator card + bio, follower
 * count and the viewer's own follow-state (null when anonymous). */
export const ConnectionUserSchema = GameOwnerSchema.extend({
  bio: z.string().nullable(),
  follower_count: z.number().int(),
  viewer: z.object({ following: z.boolean() }).nullable(),
});
export type ConnectionUser = z.infer<typeof ConnectionUserSchema>;

export const SuggestedCreatorsResponseSchema = z.object({
  items: z.array(SuggestedCreatorSchema),
});

/** The requesting user's relationship with a game (E16); null when anonymous. */
export const GameViewerStateSchema = z.object({
  liked: z.boolean(),
  saved: z.boolean(),
});
export type GameViewerState = z.infer<typeof GameViewerStateSchema>;

/** Newest top-level comments shown inline on a feed post card (E21). */
export const CommentPreviewSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: GameOwnerSchema,
  created_at: z.string(),
});
export type CommentPreview = z.infer<typeof CommentPreviewSchema>;

/** GET /games feed item — a POST card (E21): caption + author + counts +
 * inline comment previews (07 §Games + v0.7 engagement counts). */
export const FeedItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  /** The creator's post caption (set in the Post composer). */
  description: z.string().nullish(),
  cover_url: z.string().nullable(),
  /** null for the viewer's own unpublished drafts surfaced by the /me
   * library endpoints (likes/saves/history) — mirrors MyGameSchema. */
  genre: z.string().nullable(),
  owner: GameOwnerSchema,
  play_count: z.number().int(),
  remix_count: z.number().int(),
  like_count: z.number().int(),
  comment_count: z.number().int(),
  save_count: z.number().int(),
  share_count: z.number().int(),
  viewer: GameViewerStateSchema.nullable(),
  preview_comments: z.array(CommentPreviewSchema).default([]),
  /** The TRUE post time — when the game first went live (E41). The feed sorts
   * and dates cards by this. The API always emits it (string, or null for a
   * legacy row never backfilled); `nullish` also tolerates older library
   * payloads that predate the field. */
  published_at: z.string().nullish(),
  /** The draft-START time (kept — still useful, but NOT the post time). */
  created_at: z.string(),
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

export const GameSchema = FeedItemSchema.extend({
  visibility: GameVisibilitySchema.default("public"),
});
export type Game = z.infer<typeof GameSchema>;

/**
 * GET /me/games row (owner summary — game_detail_own): draft projects (v0.4)
 * have null genre/play_url until their first publish.
 */
export const MyGameSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  cover_url: z.string().nullable(),
  genre: z.string().nullable(),
  owner: GameOwnerSchema,
  status: z.string(),
  visibility: GameVisibilitySchema.default("public"),
  play_count: z.number().int(),
  remix_count: z.number().int(),
  like_count: z.number().int(),
  comment_count: z.number().int(),
  save_count: z.number().int(),
  share_count: z.number().int(),
  play_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MyGame = z.infer<typeof MyGameSchema>;

export const CurrentVersionSchema = z.object({
  id: z.string(),
  play_url: z.string(),
  change_summary: z.string().nullable(),
});
export type CurrentVersion = z.infer<typeof CurrentVersionSchema>;

export const RemixedFromSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
});
export type RemixedFrom = z.infer<typeof RemixedFromSchema>;

/** GET /games/{slug} → full detail. */
export const GameDetailSchema = GameSchema.extend({
  /** null until the planner names a genre (v0.4 draft projects). */
  genre: z.string().nullable(),
  /** null until the first publish (v0.4: draft projects exist from accept). */
  current_version: CurrentVersionSchema.nullable(),
  remixed_from: RemixedFromSchema.nullish(),
});
export type GameDetail = z.infer<typeof GameDetailSchema>;

/** GET /games/{id}/versions item. */
export const GameVersionSchema = z.object({
  id: z.string(),
  version_no: z.number().int(),
  parent_version_id: z.string().nullable(),
  change_summary: z.string().nullable(),
  created_at: z.string(),
  play_url: z.string(),
});
export type GameVersion = z.infer<typeof GameVersionSchema>;

/** GET /games/{id}/versions → all versions in an `{items}` envelope (not
 * paginated; the client unwraps to a bare array). */
export const VersionsResponseSchema = z.object({ items: GameVersionSchema.array() });
export type VersionsResponse = z.infer<typeof VersionsResponseSchema>;

export const PatchGameRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: GameVisibilitySchema.optional(),
});
export type PatchGameRequest = z.infer<typeof PatchGameRequestSchema>;

export const RollbackRequestSchema = z.object({ version_id: z.string() });
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;

export const RollbackResponseSchema = z.object({
  version_id: z.string(),
  play_url: z.string(),
});
export type RollbackResponse = z.infer<typeof RollbackResponseSchema>;

/** E22/S12 "start fresh memory" — POST /games/{id}/session/reset. */
export const SessionResetResponseSchema = z.object({
  id: z.string(),
  session_reset: z.literal(true),
});
export type SessionResetResponse = z.infer<typeof SessionResetResponseSchema>;

export const PlayRequestSchema = z.object({
  session_hash: z.string(),
  source: z.string(),
});
export type PlayRequest = z.infer<typeof PlayRequestSchema>;

export const ReportRequestSchema = z.object({ reason: z.string().min(1).max(500) });
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

// ---------------------------------------------------------------------------
// Social platform (E16, 07 v0.7)
// ---------------------------------------------------------------------------

export const ShareRequestSchema = z.object({ session_hash: z.string() });
export type ShareRequest = z.infer<typeof ShareRequestSchema>;

/** One comment row; deleted rows keep the thread shape (empty body tombstone).
 * `like_count`/`viewer_liked` mirror the game engagement fields (E39, viewer
 * state batched per page); `edited_at` is null until the first edit. */
const CommentBaseSchema = z.object({
  id: z.string(),
  body: z.string(),
  user: GameOwnerSchema,
  parent_comment_id: z.string().nullable(),
  reply_count: z.number().int(),
  like_count: z.number().int(),
  viewer_liked: z.boolean(),
  edited_at: z.string().nullable(),
  deleted: z.boolean(),
  created_at: z.string(),
});
export const CommentSchema = CommentBaseSchema.extend({
  /** Present on top-level listings: the first replies, oldest first (≤2). */
  preview_replies: z.array(CommentBaseSchema).optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CreateCommentRequestSchema = z.object({
  body: z.string().min(1).max(500),
  parent_comment_id: z.string().optional(),
});
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;

/** PATCH /comments/{id} (E39) — same body bounds as create. */
export const EditCommentRequestSchema = z.object({
  body: z.string().min(1).max(500),
});
export type EditCommentRequest = z.infer<typeof EditCommentRequestSchema>;

/** One prior-body row from GET /comments/{id}/history (E39). The current body
 * + edited_at live on the comment itself; these are the superseded versions. */
export const CommentEditSchema = z.object({
  body: z.string(),
  created_at: z.string(),
});
export type CommentEdit = z.infer<typeof CommentEditSchema>;

/** GET /comments/{id}/history — the comment's prior bodies, newest first. */
export const CommentHistoryResponseSchema = z.object({
  items: z.array(CommentEditSchema),
});
export type CommentHistoryResponse = z.infer<typeof CommentHistoryResponseSchema>;

/** GET /users/{handle} — the public creator profile. */
export const ProfileUserSchema = GameOwnerSchema.extend({
  bio: z.string().nullable(),
  created_at: z.string(),
});
export type ProfileUser = z.infer<typeof ProfileUserSchema>;

export const ProfileStatsSchema = z.object({
  games: z.number().int(),
  plays: z.number().int(),
  likes: z.number().int(),
  followers: z.number().int(),
  following: z.number().int(),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

export const ProfileSchema = z.object({
  user: ProfileUserSchema,
  stats: ProfileStatsSchema,
  viewer: z.object({ following: z.boolean() }).nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const NotificationTypeSchema = z.enum([
  "like",
  "comment",
  "reply",
  "follow",
  "remix",
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** Inbox row — rendered from the write-time snapshot (survives renames). */
export const NotificationSchema = z.object({
  id: z.string(),
  type: NotificationTypeSchema,
  actor: z.object({
    handle: z.string().nullable(),
    display_name: z.string().nullish().default(null),
    avatar_url: z.string().nullish().default(null),
  }),
  game: z
    .object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      cover_url: z.string().nullable(),
    })
    .nullish()
    .default(null),
  comment_excerpt: z.string().nullish().default(null),
  read: z.boolean(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const UnreadCountSchema = z.object({ count: z.number().int() });
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

// ---------------------------------------------------------------------------
// Jobs & generation (CONVENTIONS §4 status enum — exact strings)
// ---------------------------------------------------------------------------

/**
 * Job LIFECYCLE only (E26): the status no longer serializes pipeline shape.
 * Which phases a job goes through is the agent's business, told through
 * free-form `step`/`activity` payloads. Legacy phase statuses (pre-E26 rows
 * replayed from history) normalize to `running`.
 */
const LEGACY_RUNNING_STATUSES = new Set([
  "enhancing",
  "planning",
  "assets",
  "codegen",
  "qa",
  "publishing",
]);
export const JobStatusSchema = z.preprocess(
  (value) =>
    typeof value === "string" && LEGACY_RUNNING_STATUSES.has(value) ? "running" : value,
  z.enum(["queued", "running", "awaiting_input", "done", "failed", "expired"]),
);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobTypeSchema = z.enum(["generate", "edit", "remix", "regenerate_asset"]);
export type JobType = z.infer<typeof JobTypeSchema>;

/** Worker step events say "completed" where this contract says "done" —
 * normalized here (E26) instead of ad-hoc client patches. */
export const StepStatusSchema = z.preprocess(
  (value) => (value === "completed" ? "done" : value),
  z.enum(["pending", "running", "done", "failed"]),
);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const JobStepSchema = z.object({
  step: z.string(),
  label: z.string(),
  status: StepStatusSchema,
  started_at: z.string().nullish(),
  ended_at: z.string().nullish(),
});
export type JobStep = z.infer<typeof JobStepSchema>;

/**
 * One clarifying-question option — the worker's native `{id, label}` shape
 * (E26: the old string form still parses, id === label).
 */
export const ClarifyOptionSchema = z
  .union([z.object({ id: z.string(), label: z.string() }), z.string()])
  .transform((option) =>
    typeof option === "string" ? { id: option, label: option } : option,
  );
export type ClarifyOption = z.infer<typeof ClarifyOptionSchema>;

/**
 * Clarifying question emitted at `awaiting_input`. `single_select` renders
 * MCQ cards (answers carry the option ID); `free_text` (E26) — or any
 * question without options — renders a text box.
 */
export const ClarifyingQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.string().default("single_select"),
  options: z.array(ClarifyOptionSchema).default([]),
  default: z.string().nullish(),
});
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestionSchema>;

/**
 * One persisted transcript item (E28): a replay-shaped `activity`/`message`/
 * `file` event folded server-side from `steps_json` (activity upserts
 * collapse to final state at first-seen position). `event` stays an OPEN
 * string like every agent-shaped wire enum (E26) — clients skip kinds they
 * don't know; `data` is validated by the matching SSE payload schema at the
 * point of use, exactly like a live event.
 */
export const JobTranscriptItemSchema = z.object({
  event: z.string(),
  data: z.record(z.unknown()),
});
export type JobTranscriptItem = z.infer<typeof JobTranscriptItemSchema>;

/** GET /jobs/{id} snapshot. */
export const JobSchema = z.object({
  id: z.string(),
  type: JobTypeSchema,
  status: JobStatusSchema,
  steps: z.array(JobStepSchema).default([]),
  /** E28: the persisted activity/message/file story ([] pre-E28). */
  transcript: z.array(JobTranscriptItemSchema).default([]),
  game_id: z.string().nullish(),
  play_url: z.string().nullish(),
  error_user_msg: z.string().nullish(),
  questions: z.array(ClarifyingQuestionSchema).nullish(),
});
export type Job = z.infer<typeof JobSchema>;

export const CreateGenerateRequestSchema = z.object({
  prompt: z.string().min(3).max(1000),
  options: z
    .object({
      skip_questions: z.boolean().optional(),
      // ADR-0008: build mode for this game — omitted = server default. Stored
      // on the game and inherited by every later edit/remix.
      generation_mode: z.enum(["agent", "engine"]).optional(),
    })
    .optional(),
});
export type CreateGenerateRequest = z.infer<typeof CreateGenerateRequestSchema>;

export const CreateGenerateResponseSchema = z.object({
  job_id: z.string(),
  /** v0.4: the draft project row exists from the moment of accept. */
  game_id: z.string().nullish().default(null),
});
export type CreateGenerateResponse = z.infer<typeof CreateGenerateResponseSchema>;

export const AnswersRequestSchema = z.object({
  answers: z.record(z.string()),
});
export type AnswersRequest = z.infer<typeof AnswersRequestSchema>;

export const AnswersResponseSchema = z.object({ status: z.literal("resumed") });
export type AnswersResponse = z.infer<typeof AnswersResponseSchema>;

// ---------------------------------------------------------------------------
// Chat / remix / source (07 §Iterate & remix, §Code)
// ---------------------------------------------------------------------------

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string(),
  job_id: z.string().nullish(),
  /** E40: URL of an attached image (immutable CDN object), or null. */
  image_url: z.string().nullish().default(null),
  /** v0.5: the row's job terminal state — persistent per-job cards. */
  job: z
    .object({ status: JobStatusSchema, error_code: z.string().nullable() })
    .nullish()
    .default(null),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * E40: `message` is optional so a player can send an image ALONE; `image_base64`
 * carries an optional attachment (upload or a screenshot of the running game),
 * data-URL prefix tolerated. At least one of the two must be present.
 */
export const SendChatRequestSchema = z
  .object({
    message: z.string().max(2000).optional(),
    image_base64: z.string().optional(),
  })
  .refine((body) => Boolean(body.message && body.message.length > 0) || Boolean(body.image_base64), {
    message: "a message or an image is required",
  });
export type SendChatRequest = z.infer<typeof SendChatRequestSchema>;

export const SendChatResponseSchema = z.object({ job_id: z.string() });
export type SendChatResponse = z.infer<typeof SendChatResponseSchema>;

/** E40 server capture: the current version rendered headless → a PNG data URL,
 *  ready to attach to a chat message (image_base64). */
export const GameScreenshotResponseSchema = z.object({ image_base64: z.string() });
export type GameScreenshotResponse = z.infer<typeof GameScreenshotResponseSchema>;

export const RemixRequestSchema = z.object({
  message: z.string().min(1).max(1000).optional(),
});
export type RemixRequest = z.infer<typeof RemixRequestSchema>;

export const RemixResponseSchema = z.object({
  new_game_id: z.string(),
  job_id: z.string().nullish(),
});
export type RemixResponse = z.infer<typeof RemixResponseSchema>;

export const SourceResponseSchema = z.object({ source_html: z.string() });
export type SourceResponse = z.infer<typeof SourceResponseSchema>;

export const SaveSourceRequestSchema = z.object({ source_html: z.string() });
export type SaveSourceRequest = z.infer<typeof SaveSourceRequestSchema>;

export const SaveSourceResponseSchema = z.object({
  version_id: z.string(),
  play_url: z.string(),
});
export type SaveSourceResponse = z.infer<typeof SaveSourceResponseSchema>;

// ---------------------------------------------------------------------------
// Library & files (CONVENTIONS §3 v0.3)
// ---------------------------------------------------------------------------

export const MyAssetGameSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  cover_url: z.string().nullable(),
});
export type MyAssetGame = z.infer<typeof MyAssetGameSchema>;

/** GET /me/assets item — one generated asset + its owning game (owner-scoped). */
export const MyAssetSchema = z.object({
  id: z.string(),
  // Row-level asset type (sprite/cover/sfx/music…) — opaque on the wire; the
  // `type=` query param groups them as image (sprite+cover) / audio (sfx+music).
  type: z.string(),
  url: z.string(),
  prompt: z.string().nullable(),
  provider: z.string(),
  cost_cents: z.number().int(),
  created_at: z.string(),
  game: MyAssetGameSchema,
  version_id: z.string(),
  /** True when the asset is referenced by the game's current published version. */
  in_current_version: z.boolean(),
});
export type MyAsset = z.infer<typeof MyAssetSchema>;

export const MyAssetsPageSchema = paginated(MyAssetSchema);
export type MyAssetsPage = z.infer<typeof MyAssetsPageSchema>;

export const VersionFileKindSchema = z.enum(["code", "image", "audio", "data"]);
export type VersionFileKind = z.infer<typeof VersionFileKindSchema>;

/**
 * GET /games/{id}/versions/{vid}/files item — the ACTUAL published bundle
 * (walked from the publisher root); only `index.html` is editable.
 */
export const VersionFileSchema = z.object({
  path: z.string(),
  content_type: z.string(),
  url: z.string(),
  editable: z.boolean(),
  /** B44: text (code/data) files render read-only in the Code tab. */
  viewable: z.boolean().default(false),
  kind: VersionFileKindSchema,
});
export type VersionFile = z.infer<typeof VersionFileSchema>;

export const VersionFilesResponseSchema = z.object({
  items: z.array(VersionFileSchema),
});
export type VersionFilesResponse = z.infer<typeof VersionFilesResponseSchema>;

// ---------------------------------------------------------------------------
// SSE events (07 §GET /jobs/{id}/stream)
// ---------------------------------------------------------------------------

export const StepEventDataSchema = z.object({
  step: z.string(),
  label: z.string(),
  status: StepStatusSchema,
});
export type StepEventData = z.infer<typeof StepEventDataSchema>;

export const QuestionsEventDataSchema = z.object({
  questions: z.array(ClarifyingQuestionSchema),
});
export type QuestionsEventData = z.infer<typeof QuestionsEventDataSchema>;

export const ProgressEventDataSchema = z.object({
  step: z.string(),
  detail: z.string(),
});
export type ProgressEventData = z.infer<typeof ProgressEventDataSchema>;

/**
 * Activity kind is an OPEN string on the wire (E26): the agent may invent new
 * activity shapes without a client release. `KNOWN_ACTIVITY_KINDS` is the
 * styled set — UIs fall back to a neutral icon for anything else.
 */
export const KNOWN_ACTIVITY_KINDS = [
  "think",
  "model",
  "asset",
  "read",
  "write",
  "test",
  "fix",
  "publish",
] as const;
export const ActivityKindSchema = z.string();
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const ActivityStatusSchema = z.enum(["running", "done", "error"]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

/**
 * Media attachment on an activity row (E27): what the agent captured while
 * working — today `kind: "image"` (a game frame), open for audio/video later.
 */
export const ActivityPreviewSchema = z.object({
  kind: z.string(),
  url: z.string(),
  alt: z.string().nullish().default(null),
});
export type ActivityPreview = z.infer<typeof ActivityPreviewSchema>;

/**
 * Activity event (CONVENTIONS §4.1, v0.3): sub-step progress keyed by a
 * stable `id` — re-emitting the same id UPDATES that row (upsert; latest
 * status/detail wins). `detail`/`agent` normalize omitted → null.
 */
export const ActivityEventDataSchema = z.object({
  id: z.string(),
  kind: ActivityKindSchema,
  label: z.string(),
  detail: z.string().nullish().default(null),
  status: ActivityStatusSchema,
  agent: z.string().nullish().default(null),
  /** v0.4: optional long-form body (full reasoning summary on think rows). */
  text: z.string().nullish().default(null),
  /** E27: how `text` renders — "diff" colorizes +/− lines. Open string. */
  format: z.string().nullish().default(null),
  /** E27: media the row carries (the agent's captured game frame). */
  preview: ActivityPreviewSchema.nullish().default(null),
});
export type ActivityEventData = z.infer<typeof ActivityEventDataSchema>;

/**
 * File event (CONVENTIONS §4.1, v0.4): a bundle file was materialized or
 * rewritten (codegen output, QA fix, sprites/SFX). Rendered as file rows in
 * the thread; also the Code view's signal to refresh the live draft.
 */
/**
 * Assistant narration (CONVENTIONS §4.1, v0.5): the agent talks in the thread.
 * Also persisted as a chat_messages row — this event is the LIVE copy.
 */
export const MessageEventDataSchema = z.object({
  role: z.literal("assistant"),
  content: z.string(),
  kind: z.string().nullish().default(null),
});
export type MessageEventData = z.infer<typeof MessageEventDataSchema>;

export const FileEventDataSchema = z.object({
  path: z.string(),
  action: z.enum(["created", "updated"]),
  bytes: z.number().int().nonnegative(),
  note: z.string().nullish().default(null),
});
export type FileEventData = z.infer<typeof FileEventDataSchema>;

/** One text file of the live draft bundle (B44). */
export const JobDraftFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type JobDraftFile = z.infer<typeof JobDraftFileSchema>;

/** GET /jobs/{id}/draft (v0.4): live codegen output; null before codegen starts. */
export const JobDraftSchema = z.object({
  content: z.string().nullable(),
  /** B44: EVERY bundle text file, index.html first ([] from older workers). */
  files: z.array(JobDraftFileSchema).default([]),
});
export type JobDraft = z.infer<typeof JobDraftSchema>;

export const HealEventDataSchema = z.object({
  attempt: z.number().int(),
  summary: z.string(),
});
export type HealEventData = z.infer<typeof HealEventDataSchema>;

export const DoneEventDataSchema = z.object({
  game_id: z.string(),
  version_id: z.string(),
  play_url: z.string(),
  cover_url: z.string().nullish(),
  title: z.string(),
});
export type DoneEventData = z.infer<typeof DoneEventDataSchema>;

export const FailedEventDataSchema = z.object({
  error_code: z.string(),
  error_user_msg: z.string(),
  refunded: z.boolean(),
});
export type FailedEventData = z.infer<typeof FailedEventDataSchema>;

export const HeartbeatEventDataSchema = z.object({}).passthrough();
export type HeartbeatEventData = z.infer<typeof HeartbeatEventDataSchema>;

export const SSE_EVENT_NAMES = [
  "step",
  "questions",
  "progress",
  "activity",
  "file",
  "message",
  "heal",
  "done",
  "failed",
  "heartbeat",
] as const;
export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

/** Payload schema per SSE event name (used by the stream parser). */
export const SSE_EVENT_SCHEMAS = {
  step: StepEventDataSchema,
  questions: QuestionsEventDataSchema,
  progress: ProgressEventDataSchema,
  activity: ActivityEventDataSchema,
  file: FileEventDataSchema,
  message: MessageEventDataSchema,
  heal: HealEventDataSchema,
  done: DoneEventDataSchema,
  failed: FailedEventDataSchema,
  heartbeat: HeartbeatEventDataSchema,
} as const satisfies Record<SseEventName, z.ZodTypeAny>;

/** Typed SSE event; `id` is the per-job monotonic sequence (null if absent). */
export type SseEvent =
  | { event: "step"; id: number | null; data: StepEventData }
  | { event: "questions"; id: number | null; data: QuestionsEventData }
  | { event: "progress"; id: number | null; data: ProgressEventData }
  | { event: "activity"; id: number | null; data: ActivityEventData }
  | { event: "file"; id: number | null; data: FileEventData }
  | { event: "message"; id: number | null; data: MessageEventData }
  | { event: "heal"; id: number | null; data: HealEventData }
  | { event: "done"; id: number | null; data: DoneEventData }
  | { event: "failed"; id: number | null; data: FailedEventData }
  | { event: "heartbeat"; id: number | null; data: HeartbeatEventData };

export function isSseEventName(name: string): name is SseEventName {
  return (SSE_EVENT_NAMES as readonly string[]).includes(name);
}

export const isStepEvent = (e: SseEvent): e is Extract<SseEvent, { event: "step" }> =>
  e.event === "step";
export const isQuestionsEvent = (e: SseEvent): e is Extract<SseEvent, { event: "questions" }> =>
  e.event === "questions";
export const isProgressEvent = (e: SseEvent): e is Extract<SseEvent, { event: "progress" }> =>
  e.event === "progress";
export const isActivityEvent = (e: SseEvent): e is Extract<SseEvent, { event: "activity" }> =>
  e.event === "activity";
export const isFileEvent = (e: SseEvent): e is Extract<SseEvent, { event: "file" }> =>
  e.event === "file";
export const isMessageEvent = (e: SseEvent): e is Extract<SseEvent, { event: "message" }> =>
  e.event === "message";
export const isHealEvent = (e: SseEvent): e is Extract<SseEvent, { event: "heal" }> =>
  e.event === "heal";
export const isDoneEvent = (e: SseEvent): e is Extract<SseEvent, { event: "done" }> =>
  e.event === "done";
export const isFailedEvent = (e: SseEvent): e is Extract<SseEvent, { event: "failed" }> =>
  e.event === "failed";
export const isHeartbeatEvent = (e: SseEvent): e is Extract<SseEvent, { event: "heartbeat" }> =>
  e.event === "heartbeat";

// ---------------------------------------------------------------------------
// Feed query & misc request types
// ---------------------------------------------------------------------------

/** `for_you` (E41) is the personalized default the web home requests. */
export const FeedSortSchema = z.enum(["for_you", "new", "trending", "following"]);
export type FeedSort = z.infer<typeof FeedSortSchema>;

export interface PageParams {
  cursor?: string;
  limit?: number;
}

/** GET /me/creator/payouts query — the history pages by cursor only. */
export interface PayoutsParams {
  cursor?: string;
}

export interface FeedParams extends PageParams {
  sort?: FeedSort;
  genre?: string;
  /** Title search (v0.7) — composes with any sort/genre. */
  q?: string;
}

/** GET /games/{id}/comments query (v0.7). */
export interface CommentsParams extends PageParams {
  /** When set, pages the replies of that comment (oldest first). */
  parent?: string;
}

/** GET /me/assets query — `type=image` ⇒ sprite+cover rows, `audio` ⇒ sfx+music. */
export interface MeAssetsParams extends PageParams {
  type?: "image" | "audio";
  scope?: "all" | "current" | "unused";
  /** Server-side prompt/label search. */
  q?: string;
  game_id?: string;
}
