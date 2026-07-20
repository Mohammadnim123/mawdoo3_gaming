/**
 * E22/S11: the Fix-it message carries what automatic repair ALREADY tried.
 *
 * The QA heal ladder narrates each attempt ("Fixing: TypeError …") as heal
 * events; replaying those summaries in the recovery prompt stops the fix-mode
 * agent from re-applying the exact patches that just failed.
 */

export interface HealAttempt {
  attempt: number;
  summary: string;
}

const BASE = "Fix the errors and finish the game.";
const MAX_TRIED = 3;

export function fixItMessage(heals: readonly HealAttempt[]): string {
  const tried = [
    ...new Set(
      heals
        .map((heal) => heal.summary.replace(/^Fixing: /, "").trim())
        .filter((summary) => summary !== ""),
    ),
  ].slice(-MAX_TRIED);
  if (tried.length === 0) return BASE;
  const times = heals.length === 1 ? "once" : `${heals.length} times`;
  return (
    `${BASE} Automatic repair already tried ${times} and failed — it attempted: ` +
    `${tried.join("; ")}. Take a different approach instead of repeating those patches.`
  );
}
