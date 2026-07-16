// Version history with lineage indent, current badge, preview + rollback
// (ported from @codply/ui VersionTree).

import type { VersionItem } from "../lib/types";

export function VersionTree({
  versions,
  currentVersionId,
  previewVersionId,
  busy,
  labels,
  onPreview,
  onRollback,
}: {
  versions: VersionItem[];
  currentVersionId: string | null;
  previewVersionId: string | null;
  busy: boolean;
  labels: { current: string; preview: string; restore: string; initial: string };
  onPreview: (version: VersionItem) => void;
  onRollback: (version: VersionItem) => void;
}) {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const depth = (v: VersionItem): number => {
    let d = 0;
    let cursor: VersionItem | undefined = v;
    while (cursor?.parent_version_id && byId.has(cursor.parent_version_id) && d < 6) {
      cursor = byId.get(cursor.parent_version_id);
      d += 1;
    }
    return d;
  };

  return (
    <ol className="space-y-2">
      {[...versions].reverse().map((version) => {
        const isCurrent = version.id === currentVersionId;
        const isPreviewed = version.id === previewVersionId;
        return (
          <li
            key={version.id}
            style={{ marginInlineStart: `${Math.min(depth(version), 4) * 12}px` }}
            className={`rounded-xl border p-3 ${
              isPreviewed
                ? "border-[var(--color-violet)]/60 bg-[var(--color-surface-2)]"
                : "border-[var(--color-edge-subtle)] bg-[var(--color-surface-1)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[var(--color-cyan)]">
                v{version.version_no}
              </span>
              {isCurrent && (
                <span className="rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-success)]">
                  {labels.current}
                </span>
              )}
              <span className="ms-auto text-[10px] text-[var(--color-ink-muted)]">
                {new Date(version.created_at).toLocaleString()}
              </span>
            </div>
            <div className="mt-1 truncate text-sm text-[var(--color-ink-secondary)]">
              {version.change_summary || labels.initial}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="fp-btn fp-btn-ghost fp-btn-sm"
                disabled={busy}
                onClick={() => onPreview(version)}
              >
                {labels.preview}
              </button>
              {!isCurrent && (
                <button
                  type="button"
                  className="fp-btn fp-btn-soft fp-btn-sm"
                  disabled={busy}
                  onClick={() => onRollback(version)}
                >
                  {labels.restore}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
