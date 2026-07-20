/**
 * E29-F2: plan-aware actions + short titles for a failed job, derived from
 * the wire `error_code`. The server's `error_user_msg` is deliberately
 * plan-neutral (`forgeplay_core.domain.failures.FailureCopy`) — the calls
 * to action are the client's business because plan state lives client-side.
 *
 * Codes match by PREFIX so parameterized codes ("lint_blocked: fetch",
 * "bundle_too_large: total 27MB", "agent_error_max_budget_usd") inherit
 * their family.
 */

export type FailureActionKind = "fixIt" | "tryAgain" | "upgrade";

export interface FailureAction {
  kind: FailureActionKind;
  label: string;
}

/** How the failure should read: caused by the build (the player can steer
 * a fix), by our side (retry is the honest ask), or by the player's stop. */
export type FailureTone = "actionable" | "infra" | "cancelled";

/** Budget/turns exhaustion — the ONE family a plan upgrade actually fixes. */
const EXHAUSTION_PREFIX = "agent_error_max_";

/**
 * Families where a salvaged draft exists in the workspace, so "Fix it"
 * (continue from the draft) is the honest primary action. `agent_` covers
 * both exhaustion deaths (the workspace build is salvaged) and
 * `agent_no_output`.
 */
const FIXABLE_PREFIXES = ["qa_failed", "lint_blocked", "bundle_too_large", "agent_"] as const;

/** Codes that produced NO draft to continue from — "Fix it" would lie. */
const NOT_FIXABLE = ["expired"] as const;

const UPGRADE_LABEL = "Upgrade for bigger builds";

function matchesPrefix(errorCode: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => errorCode.startsWith(prefix));
}

/**
 * Ordered action descriptors for a failed job's footer. `planKey` is the
 * viewer's subscription plan key (null while unknown/anonymous — never
 * upsell blind).
 */
export function failureActions(errorCode: string | null, planKey: string | null): FailureAction[] {
  if (errorCode === "cancelled") return [];
  const code = errorCode ?? "";
  const actions: FailureAction[] = [];
  // Unknown codes keep Fix it: the draft mirror survives most failures and
  // a wrong "Fix it" degrades to a normal chat message — never a dead end.
  if (!matchesPrefix(code, NOT_FIXABLE)) {
    actions.push({ kind: "fixIt", label: "Fix it" });
  }
  actions.push({ kind: "tryAgain", label: "Try again" });
  if (code.startsWith(EXHAUSTION_PREFIX) && planKey === "free") {
    actions.push({ kind: "upgrade", label: UPGRADE_LABEL });
  }
  return actions;
}

/** Catalog key of the short headline per family (E33: screens localize). */
export type FailureTitleKey =
  | "outOfBudget"
  | "didNotPassChecks"
  | "sandboxBlocked"
  | "tooLarge"
  | "couldNotFinish";

export function failureTitleKey(errorCode: string | null): FailureTitleKey {
  const code = errorCode ?? "";
  if (code.startsWith(EXHAUSTION_PREFIX)) return "outOfBudget";
  if (code.startsWith("qa_failed")) return "didNotPassChecks";
  if (code.startsWith("lint_blocked")) return "sandboxBlocked";
  if (code.startsWith("bundle_too_large")) return "tooLarge";
  return "couldNotFinish";
}

const TITLE_COPY: Record<FailureTitleKey, string> = {
  outOfBudget: "Ran out of budget",
  didNotPassChecks: "Didn't pass checks",
  sandboxBlocked: "Sandbox blocked it",
  tooLarge: "Too large",
  couldNotFinish: "Couldn't finish",
};

/** Short headline per family — the specific sentence stays `error_user_msg`.
 * English copy; localized screens map `failureTitleKey` into the catalog. */
export function failureTitle(errorCode: string | null): string {
  return TITLE_COPY[failureTitleKey(errorCode)];
}

/** Styling hook: build-caused families read as actionable; everything
 * unknown is our side (infra) and must not blame the prompt. */
export function failureTone(errorCode: string | null): FailureTone {
  if (errorCode === "cancelled") return "cancelled";
  if (errorCode !== null && matchesPrefix(errorCode, FIXABLE_PREFIXES)) return "actionable";
  return "infra";
}
