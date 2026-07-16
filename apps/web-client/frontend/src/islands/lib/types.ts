// Wire contract for the generation stream, mirrored from the engine's SSE
// vocabulary (step | questions | progress | activity | file | message | heal |
// done | failed) proxied by Django at /studio/jobs/<ref>/stream.

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepRow {
  step: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface ClarifyOption {
  id: string;
  label: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  options: ClarifyOption[];
  default_option_id?: string;
}

export interface ActivityRow {
  id: string;
  kind?: string;
  label: string;
  detail?: string;
  status?: "running" | "done" | "error";
}

export interface HealNote {
  attempt: number;
  summary: string;
}

export type JobPhase =
  | "connecting"
  | "running"
  | "awaiting_input"
  | "done"
  | "failed";

export interface JobStreamState {
  phase: JobPhase;
  steps: StepRow[];
  activities: ActivityRow[];
  heals: HealNote[];
  messages: string[];
  questions: ClarifyQuestion[];
  doneGameId: string | null;
  doneTitle: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  lastSeq: number;
}

export interface VersionItem {
  id: string;
  version_no: number;
  parent_version_id: string | null;
  change_summary: string;
  play_url: string;
  created_at: string;
}

export interface FeedOwner {
  handle: string;
  display_name: string;
  avatar_url: string;
}

export interface FeedItem {
  id: string;
  slug: string;
  title: string;
  genre: string;
  summary: string;
  cover_url: string;
  play_url: string;
  game_origin: string;
  owner: FeedOwner;
  play_count: number;
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  remix_count: number;
  viewer: { liked: boolean; saved: boolean };
}

export type Labels = Record<string, string>;
