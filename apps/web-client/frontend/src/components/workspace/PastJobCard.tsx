"use client";

import type { ReactElement } from "react";
import type { JobStreamState } from "@/domain/jobStream/reducer";
import type { ThreadPastJobItem } from "@/domain/workspace/thread";
import { GenerationCard } from "./GenerationCard";
import { JobNote } from "./ChatThread";

export interface PastJobCardProps {
  item: ThreadPastJobItem;
  /** Snapshot-derived state; null while loading or after a failed fetch. */
  state: JobStreamState | null;
}

/**
 * A finished job's persistent transcript card (E28): the same generation
 * card the player watched live, replayed from the snapshot transcript.
 * Degrades to the one-line outcome note while loading, on fetch failure and
 * for legacy jobs with an empty transcript — a missing job never breaks the
 * thread.
 */
export function PastJobCard({ item, state }: PastJobCardProps): ReactElement {
  if (state === null || state.timeline.length === 0) {
    return <JobNote note={item} />;
  }
  return <GenerationCard past stream={{ ...state, connected: false, transportError: false }} />;
}
