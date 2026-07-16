/**
 * Alpha tint of an accent color for inline styles. Works with BOTH literal
 * hex tokens and `var(--color-*)` references (E32) — the old hex-suffix
 * concatenation (`${accent}1A`) silently produced invalid CSS for var()
 * accents and pinned every tint to the dark palette.
 */
export function tint(accent: string, percent: number): string {
  return `color-mix(in srgb, ${accent} ${percent}%, transparent)`;
}
