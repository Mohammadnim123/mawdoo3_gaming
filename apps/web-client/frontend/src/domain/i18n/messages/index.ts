import type { Locale } from "../locale";
import { en, type Messages } from "./en";
import { ar } from "./ar";

export type { Messages } from "./en";

/** Every catalog, keyed by locale — both ship in the bundle (small, typed). */
export const MESSAGES: Record<Locale, Messages> = { en, ar };

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}
