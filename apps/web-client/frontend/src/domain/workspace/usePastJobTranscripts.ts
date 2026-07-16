"use client";

import { useQueries } from "@tanstack/react-query";
import { getServices } from "../services";
import { seedFromSnapshot, type JobStreamState } from "../jobStream/reducer";

/** Query key for one past job's snapshot (immutable once terminal). */
export function pastJobKey(jobId: string): readonly unknown[] {
  return ["past-job", jobId];
}

/**
 * Snapshot-derived stream states for the PAST jobs visible in the thread
 * (E28): one `GET /jobs/{id}` per job, run through the SAME snapshot→state
 * transform the live stream seeds from. Terminal jobs are immutable, so the
 * cache never goes stale. A failed fetch simply leaves its id out of the
 * map — the thread falls back to the one-line note, it never breaks.
 */
export function usePastJobTranscripts(jobIds: readonly string[]): Map<string, JobStreamState> {
  return useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: pastJobKey(jobId),
      queryFn: () => getServices().jobs.snapshot(jobId),
      staleTime: Infinity,
      retry: 1,
    })),
    combine: (results) => {
      const map = new Map<string, JobStreamState>();
      results.forEach((result, index) => {
        const jobId = jobIds[index];
        if (jobId !== undefined && result.data !== undefined) {
          map.set(jobId, seedFromSnapshot(result.data));
        }
      });
      return map;
    },
  });
}
