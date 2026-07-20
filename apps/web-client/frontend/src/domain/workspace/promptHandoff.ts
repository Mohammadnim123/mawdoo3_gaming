/**
 * `/create` → `/studio?job={id}` handoff (E14-F1): the job snapshot does not
 * echo the prompt back, so the submitting page parks it in sessionStorage and
 * the workspace recalls it to seed the first user bubble. Best-effort — a
 * missing prompt only means the thread starts at the generation card.
 */

interface PromptStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const keyFor = (jobId: string): string => `fp:job-prompt:${jobId}`;

function defaultStore(): PromptStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked (private mode / embedded)
  }
}

export function rememberJobPrompt(jobId: string, prompt: string, store = defaultStore()): void {
  try {
    store?.setItem(keyFor(jobId), prompt);
  } catch {
    // Quota/permission failures are non-fatal by design.
  }
}

export function recallJobPrompt(jobId: string, store = defaultStore()): string | null {
  try {
    return store?.getItem(keyFor(jobId)) ?? null;
  } catch {
    return null;
  }
}

export function forgetJobPrompt(jobId: string, store = defaultStore()): void {
  try {
    store?.removeItem(keyFor(jobId));
  } catch {
    // Non-fatal.
  }
}
