/**
 * Lint findings from a blocked `PUT /games/{id}/source` (422). The envelope's
 * `details.findings` shape is defensive-parsed — the linter may send strings
 * or structured rows.
 */

export interface SourceFinding {
  message: string;
  line?: number;
  rule?: string;
}

export function parseSourceFindings(details: Record<string, unknown>): SourceFinding[] {
  const raw = details["findings"];
  if (!Array.isArray(raw)) return [];
  return raw.map((item): SourceFinding => {
    if (typeof item === "string") return { message: item };
    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      return {
        message: typeof record["message"] === "string" ? record["message"] : JSON.stringify(item),
        line: typeof record["line"] === "number" ? record["line"] : undefined,
        rule: typeof record["rule"] === "string" ? record["rule"] : undefined,
      };
    }
    return { message: String(item) };
  });
}
