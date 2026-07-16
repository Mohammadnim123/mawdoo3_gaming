import type { JobActivity } from "../jobStream/reducer";

/**
 * E14-F3 helpers over the reducer's activity rows. Pure — the generation
 * card renders straight from these.
 */

/** True while the LATEST think-activity is still running (ThinkingIndicator). */
export function isThinking(activities: JobActivity[]): boolean {
  for (let i = activities.length - 1; i >= 0; i -= 1) {
    const row = activities[i];
    if (row?.kind === "think") return row.status === "running";
  }
  return false;
}

/** Rows belonging to one step section (null = before any step started). */
export function activitiesForStep(activities: JobActivity[], step: string | null): JobActivity[] {
  return activities.filter((a) => a.step === step);
}
