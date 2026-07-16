import type { JobStatus } from "@codply/contracts";
import { isTerminalStatus } from "../jobStream/reducer";

/**
 * Composer state machine (E14-F7):
 * - `idle`     → textarea + send (POST /generate or POST /games/{id}/chat)
 * - `running`  → send swaps to STOP (POST /jobs/{id}/cancel)
 * - `awaiting` → disabled with helper text; the clarify cards are the input
 */
export type ComposerMode = "idle" | "running" | "awaiting";

export interface ComposerInput {
  /** Job the workspace is currently tracking (null = nothing in flight). */
  jobId: string | null;
  /** Streamed job status (ignored when jobId is null). */
  status: JobStatus;
}

export function deriveComposerMode(input: ComposerInput): ComposerMode {
  if (input.jobId === null || isTerminalStatus(input.status)) return "idle";
  if (input.status === "awaiting_input") return "awaiting";
  return "running";
}
