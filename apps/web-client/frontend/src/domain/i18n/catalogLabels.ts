/**
 * E33 — wire-key → localized-label lookups. The wire carries OPEN strings
 * (genres, step names, credit kinds, plan feature keys); KNOWN keys map to
 * catalog entries, unknown ones fall back to the token tables / raw key so
 * new server values never break the UI.
 */

import { creditKindMeta, genreMeta, stepMeta } from "@codply/ui";
import type { Messages } from "./messages";

export function genreLabel(t: Messages, genre: string): string {
  const table = t.genres as Readonly<Record<string, string>>;
  return table[genre.toLowerCase()] ?? genreMeta(genre).label;
}

export function stepLabel(t: Messages, step: string): string {
  const table = t.steps as Readonly<Record<string, string>>;
  return table[step] ?? stepMeta(step).label;
}

export function creditKindLabel(t: Messages, kind: string): string {
  const table = t.credits.kinds as Readonly<Record<string, string>>;
  return table[kind] ?? creditKindMeta(kind).label;
}

/** Plan feature keys (`GET /me/subscription`) → human copy. */
export function planFeatureLabel(t: Messages, key: string): string {
  const table = t.pricing.features as Readonly<Record<string, string>>;
  return table[key] ?? key.replace(/_/g, " ");
}
