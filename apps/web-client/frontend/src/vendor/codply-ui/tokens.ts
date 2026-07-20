/**
 * Codply design tokens — the single source of truth for color, type,
 * spacing, radius and motion (CONVENTIONS §7). App code must consume these
 * (or the Tailwind theme mapped to them in styles.css); raw hex in app code
 * is a lint error.
 *
 * Design language: FLAT (zero box-shadow — elevation via borders + layered
 * background tones), dark-first near-black canvas, violet→cyan gradient
 * reserved for generate/CTA moments, a hue + lucide icon for everything.
 *
 * THEMING (E32): the hex values here are the DARK palette — the reference
 * theme and the values behind the `@theme` block in styles.css. The light
 * palette lives ONLY in styles.css (`[data-theme="light"]`). Components
 * that need a themed color in an inline style must use `var(--color-*)`
 * references, never these constants — a literal from this file will not
 * follow the active theme. (CodePane is the one deliberate exception: the
 * code editor stays dark in both themes, like every serious editor.)
 */

// ---------------------------------------------------------------------------
// Color — canvas / surface / border / text scales
// ---------------------------------------------------------------------------

export const color = {
  /** Page background. */
  canvas: "#0A0A0F",
  /** Layered surfaces: 1 = card, 2 = raised (inputs, chips), 3 = highest (menus). */
  surface1: "#12121A",
  surface2: "#1A1A24",
  surface3: "#22222E",
  /** Border scale — elevation is drawn with borders, never shadows. */
  borderSubtle: "#1E1E2A",
  border: "#2A2A3A",
  borderStrong: "#3D3D52",
  /** Text scale. */
  textPrimary: "#F4F4F8",
  textSecondary: "#A0A0B8",
  textMuted: "#6B6B80",
  /** Text on top of accent/gradient fills — near-black on the dark theme
   * (this file is the dark reference); the light theme uses white. */
  textOnAccent: "#0A0A0F",
  /** Accent pair — gradient use is reserved for generate/CTA moments. */
  violet: "#8B5CF6",
  cyan: "#22D3EE",
  /** Semantic. */
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#F43F5E",
  info: "#0EA5E9",
  /** Decorative accents (step/activity/credit metas, fallback genre). */
  pink: "#EC4899",
  orange: "#F97316",
  lime: "#84CC16",
  slate: "#94A3B8",
} as const;

/** The one gradient. Generate/CTA moments only — identical in both themes
 * (a vibrant FILL with fixed dark on-accent text), hence literal hex. */
export const accentGradient = `linear-gradient(135deg, ${color.violet} 0%, ${color.cyan} 100%)` as const;

// ---------------------------------------------------------------------------
// Genres — every genre gets a hue + a lucide icon name
// ---------------------------------------------------------------------------

export interface GenreMeta {
  /** Base hue for chips, tints and accents. */
  hue: string;
  /** lucide-react icon name (resolved in @codply/ui components). */
  icon: string;
  /** Human label. */
  label: string;
}

/** Hues are `var(--color-genre-*)` references (E32) so genre chips and
 * card tints follow the active theme — the palettes live in styles.css.
 * Consumers put them in CSS contexts only (style props / color-mix). */
export const GENRE_HUES = {
  runner: { hue: "var(--color-genre-runner)", icon: "Footprints", label: "Runner" },
  platformer: { hue: "var(--color-genre-platformer)", icon: "Mountain", label: "Platformer" },
  puzzle: { hue: "var(--color-genre-puzzle)", icon: "Puzzle", label: "Puzzle" },
  shooter: { hue: "var(--color-genre-shooter)", icon: "Crosshair", label: "Shooter" },
  arcade: { hue: "var(--color-genre-arcade)", icon: "Joystick", label: "Arcade" },
  snake: { hue: "var(--color-genre-snake)", icon: "Worm", label: "Snake" },
  breakout: { hue: "var(--color-genre-breakout)", icon: "BrickWall", label: "Breakout" },
  flappy: { hue: "var(--color-genre-flappy)", icon: "Bird", label: "Flappy" },
} as const satisfies Record<string, GenreMeta>;

export type KnownGenre = keyof typeof GENRE_HUES;

export const FALLBACK_GENRE_META: GenreMeta = {
  hue: "var(--color-slate)",
  icon: "Gamepad2",
  label: "Game",
};

/** Genre metadata with a safe fallback for unknown/new genres. */
export function genreMeta(genre: string): GenreMeta {
  const key = genre.toLowerCase() as KnownGenre;
  return GENRE_HUES[key] ?? { ...FALLBACK_GENRE_META, label: genre || FALLBACK_GENRE_META.label };
}

// ---------------------------------------------------------------------------
// Job steps — hue + icon + human label per pipeline step (CONVENTIONS §4)
// ---------------------------------------------------------------------------

export interface StepMeta {
  /** lucide-react icon name. */
  icon: string;
  /** Step accent color. */
  color: string;
  /** Friendly label shown in the StepTimeline. */
  label: string;
}

export type JobStepName =
  | "queued"
  | "running"
  | "enhancing"
  | "planning"
  | "awaiting_input"
  | "assets"
  | "codegen"
  | "qa"
  | "publishing"
  | "done"
  | "failed"
  | "expired";

/** Styling table for KNOWN step names — E26: steps are open strings on the
 * wire (the agent narrates its own phases); `stepMeta` falls back safely. */
export const STEP_META: Record<JobStepName, StepMeta> = {
  queued: { icon: "Hourglass", color: "var(--color-slate)", label: "In the queue" },
  running: { icon: "Loader", color: "var(--color-violet)", label: "Working on it" },
  enhancing: { icon: "Sparkles", color: "var(--color-violet)", label: "Understanding your idea" },
  planning: { icon: "PencilRuler", color: "var(--color-info)", label: "Designing your game" },
  awaiting_input: {
    icon: "MessageCircleQuestion",
    color: "var(--color-warning)",
    label: "Waiting for you",
  },
  assets: { icon: "Palette", color: "var(--color-pink)", label: "Drawing art & sound" },
  codegen: { icon: "Code2", color: "var(--color-success)", label: "Building your game" },
  qa: { icon: "Bug", color: "var(--color-orange)", label: "Testing & fixing" },
  publishing: { icon: "Rocket", color: "var(--color-cyan)", label: "Publishing" },
  done: { icon: "PartyPopper", color: "var(--color-lime)", label: "Ready to play" },
  failed: { icon: "TriangleAlert", color: "var(--color-danger)", label: "Something went wrong" },
  expired: { icon: "TimerOff", color: "var(--color-ink-muted)", label: "Expired" },
};

/** Step metadata with a safe fallback for unknown step names. */
export function stepMeta(step: string): StepMeta {
  return (
    STEP_META[step as JobStepName] ?? {
      icon: "Circle",
      color: "var(--color-ink-muted)",
      label: step,
    }
  );
}

// ---------------------------------------------------------------------------
// Activity kinds — hue + icon per live agent-activity row (CONVENTIONS §4.1)
// ---------------------------------------------------------------------------

export interface ActivityKindMeta {
  /** lucide-react icon name (resolved in @codply/ui components). */
  icon: string;
  /** Distinct accent hue for the row's icons. */
  color: string;
  /** Human label for the kind (tooltips, legends). */
  label: string;
}

export type ActivityKindName =
  | "think"
  | "model"
  | "asset"
  | "read"
  | "write"
  | "test"
  | "fix"
  | "shot"
  | "publish";

export const ACTIVITY_KIND_META: Record<ActivityKindName, ActivityKindMeta> = {
  think: { icon: "Brain", color: "var(--color-violet)", label: "Thinking" },
  model: { icon: "Sparkles", color: "var(--color-cyan)", label: "Model" },
  asset: { icon: "Palette", color: "var(--color-pink)", label: "Asset" },
  read: { icon: "FileSearch", color: "var(--color-info)", label: "Read" },
  write: { icon: "FilePenLine", color: "var(--color-success)", label: "Write" },
  test: { icon: "FlaskConical", color: "var(--color-orange)", label: "Test" },
  fix: { icon: "Wrench", color: "var(--color-warning)", label: "Fix" },
  shot: { icon: "Camera", color: "var(--color-pink)", label: "Frame" },
  publish: { icon: "Rocket", color: "var(--color-lime)", label: "Publish" },
};

/** Activity-kind metadata with a safe fallback for unknown kinds. */
export function activityKindMeta(kind: string): ActivityKindMeta {
  return (
    ACTIVITY_KIND_META[kind as ActivityKindName] ?? {
      icon: "Circle",
      color: "var(--color-ink-muted)",
      label: kind,
    }
  );
}

// ---------------------------------------------------------------------------
// Credit ledger kinds — hue + icon + human label per row (E29, 06 v0.20)
// ---------------------------------------------------------------------------

export interface CreditKindMeta {
  /** lucide-react icon name (resolved in @codply/ui components). */
  icon: string;
  /** Accent hue for the row's icon. */
  color: string;
  /** Human label ("AI generation", "Initial free credits", …). */
  label: string;
}

export type CreditKindName =
  | "grant_initial"
  | "grant_daily"
  | "grant_plan_reset"
  | "spend_job"
  | "refund_job"
  | "admin_adjust";

/** Styling table for KNOWN ledger kinds — the wire is an open string (E29):
 * `creditKindMeta` falls back safely for kinds shipped after this build. */
export const CREDIT_KIND_META: Record<CreditKindName, CreditKindMeta> = {
  grant_initial: { icon: "Gift", color: "var(--color-success)", label: "Initial free credits" },
  grant_daily: { icon: "CalendarCheck", color: "var(--color-cyan)", label: "Daily credits" },
  grant_plan_reset: { icon: "RefreshCcw", color: "var(--color-violet)", label: "Plan credits" },
  spend_job: { icon: "Sparkles", color: "var(--color-warning)", label: "AI generation" },
  refund_job: { icon: "Undo2", color: "var(--color-info)", label: "Refund" },
  admin_adjust: { icon: "SlidersHorizontal", color: "var(--color-slate)", label: "Adjustment" },
};

/** Credit-kind metadata with a safe fallback for unknown kinds. */
export function creditKindMeta(kind: string): CreditKindMeta {
  return (
    CREDIT_KIND_META[kind as CreditKindName] ?? {
      icon: "Circle",
      color: "var(--color-ink-muted)",
      label: kind,
    }
  );
}

// ---------------------------------------------------------------------------
// Type, spacing, radius, motion
// ---------------------------------------------------------------------------

export const font = {
  display: `"Space Grotesk", var(--font-display-fallback, Inter), system-ui, sans-serif`,
  sans: `Inter, system-ui, -apple-system, sans-serif`,
  mono: `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`,
} as const;

/** 8px spacing scale (px). */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 40,
  8: 48,
  9: 64,
  10: 80,
} as const;

/** Radii (px). House default is `xl` = rounded-2xl. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  full: 9999,
} as const;

/** Motion durations (ms) — 150–250ms ease-out micro-interactions. */
export const motionDuration = {
  fast: 150,
  base: 200,
  slow: 250,
} as const;

export const motionEase = [0, 0, 0.2, 1] as const; // ease-out
export const motionEaseCss = "cubic-bezier(0, 0, 0.2, 1)" as const;

// ---------------------------------------------------------------------------
// Mobile-first ergonomics
// ---------------------------------------------------------------------------

/**
 * Minimum touch-target edge (px) on coarse pointers — WCAG 2.5.8 / Apple HIG.
 * Interactive primitives (Button, IconButton, Chip, tab triggers, radio
 * options) guarantee this via the `.fp-hit` pointer-coarse hit-slop in
 * styles.css: the visual size stays unchanged on desktop, while an invisible
 * `::after` expands the hit area to at least this square on touch devices.
 */
export const TOUCH_TARGET_MIN = 44 as const;

/**
 * Fluid type scale — `clamp()` expressions for headings so 390px never looks
 * cramped and desktop never looks gigantic. Use via the `.fp-title-*` classes
 * (styles.css) or inline `text-[length:…]` arbitrary values.
 *
 * Notes:
 * - `hero`  : landing headline — 36px at 390px, capped at 60px.
 * - `page`  : route h1 — 24px on phones up to 32px on desktop.
 * - `section`: section h2 — 18px → 22px.
 * - Body text never goes below 16px inside form fields (iOS focus-zoom guard,
 *   enforced by Input/Textarea).
 */
export const fluidType = {
  hero: "clamp(2.25rem, 1rem + 6vw, 3.75rem)",
  page: "clamp(1.5rem, 1.1rem + 2vw, 2rem)",
  section: "clamp(1.125rem, 1rem + 0.75vw, 1.375rem)",
} as const;

/** Framer Motion transition presets. */
export const transition = {
  fast: { duration: motionDuration.fast / 1000, ease: motionEase },
  base: { duration: motionDuration.base / 1000, ease: motionEase },
  slow: { duration: motionDuration.slow / 1000, ease: motionEase },
} as const;
