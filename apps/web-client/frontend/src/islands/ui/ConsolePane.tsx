// Console feed of bridge events from the sandboxed game (ready / score /
// game_over / errors). Ported from @codply/ui ConsolePane, fed by our
// template's postMessage envelope instead of console forwarding.

export interface ConsoleEntry {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  ts: number;
}

const LEVEL_COLOR: Record<ConsoleEntry["level"], string> = {
  info: "text-[var(--color-ink-secondary)]",
  warn: "text-[var(--color-warning)]",
  error: "text-[var(--color-danger)]",
};

export function ConsolePane({ entries, emptyLabel }: { entries: ConsoleEntry[]; emptyLabel: string }) {
  return (
    <div className="h-full overflow-y-auto rounded-xl border border-[var(--color-edge-subtle)] bg-[var(--color-surface-1)] p-3 font-mono text-xs">
      {entries.length === 0 ? (
        <div className="text-[var(--color-ink-muted)]">{emptyLabel}</div>
      ) : (
        entries.slice(-200).map((entry) => (
          <div key={entry.id} className={`whitespace-pre-wrap ${LEVEL_COLOR[entry.level]}`}>
            <span className="opacity-50">
              {new Date(entry.ts).toLocaleTimeString()}{" "}
            </span>
            {entry.message}
          </div>
        ))
      )}
    </div>
  );
}
