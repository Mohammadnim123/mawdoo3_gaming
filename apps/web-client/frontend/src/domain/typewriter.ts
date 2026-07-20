/**
 * Typewriter — the hero placeholder's type/hold/delete/rest cycle as a
 * framework-free state machine. React only schedules timeouts with the
 * delays this class emits; every transition is deterministic and unit
 * tested (no timers in here).
 *
 * Cycle per phrase: type it code-point by code-point → hold the full
 * phrase → delete it → rest empty → next phrase (looping forever).
 */

export interface TypewriterFrame {
  /** Text to show right now. */
  text: string;
  /** How long to show it before calling `next()` again. */
  delayMs: number;
}

export interface TypewriterTiming {
  typeMs: number;
  deleteMs: number;
  /** Pause with the full phrase on screen. */
  holdMs: number;
  /** Pause on empty before the next phrase starts. */
  restMs: number;
}

export const DEFAULT_TIMING: TypewriterTiming = {
  typeMs: 45,
  deleteMs: 22,
  holdMs: 2200,
  restMs: 450,
};

type Phase = "typing" | "holding" | "deleting" | "resting";

export class Typewriter {
  private readonly phrases: readonly string[][];
  private readonly timing: TypewriterTiming;
  private phrase = 0;
  private length = 0;
  private phase: Phase = "typing";

  constructor(phrases: readonly string[], timing: Partial<TypewriterTiming> = {}) {
    // Code points, not UTF-16 units — Arabic and emoji must never tear.
    this.phrases = phrases.filter((p) => p.length > 0).map((p) => Array.from(p));
    this.timing = { ...DEFAULT_TIMING, ...timing };
  }

  /** True when there is nothing to animate (show a static placeholder). */
  get empty(): boolean {
    return this.phrases.length === 0;
  }

  private get current(): string[] {
    return this.phrases[this.phrase] ?? [];
  }

  /** Advance one step and return the frame to render. */
  next(): TypewriterFrame {
    if (this.empty) return { text: "", delayMs: Number.POSITIVE_INFINITY };
    const { deleteMs, restMs } = this.timing;
    switch (this.phase) {
      case "typing":
        return this.typeStep();
      case "holding":
        this.phase = "deleting";
        return { text: this.text(), delayMs: deleteMs };
      case "deleting": {
        this.length -= 1;
        if (this.length <= 0) {
          this.length = 0;
          this.phase = "resting";
          return { text: "", delayMs: restMs };
        }
        return { text: this.text(), delayMs: deleteMs };
      }
      case "resting":
        this.phrase = (this.phrase + 1) % this.phrases.length;
        this.phase = "typing";
        this.length = 0;
        return this.typeStep();
    }
  }

  /** One character forward; a completed phrase transitions to the hold.
   * Shared by "typing" and "resting" so 1-char phrases can't double-frame. */
  private typeStep(): TypewriterFrame {
    this.length = Math.min(this.length + 1, this.current.length);
    const done = this.length >= this.current.length;
    if (done) this.phase = "holding";
    return { text: this.text(), delayMs: done ? this.timing.holdMs : this.timing.typeMs };
  }

  private text(): string {
    return this.current.slice(0, this.length).join("");
  }
}
