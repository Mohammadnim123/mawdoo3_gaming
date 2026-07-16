"use client";

import type { ReactElement, ReactNode } from "react";
import { AudioLines, Pause, Play } from "lucide-react";
import { cn } from "../lib/cn";
import { IconButton } from "../primitives/IconButton";

export interface AudioAssetRowProps {
  label: string;
  /** Play/pause state is owned by the caller (one shared <audio> element). */
  playing: boolean;
  onToggle: () => void;
  /** Muted trailing text (provider, kind, …) — duration-agnostic by design. */
  detail?: string;
  /** Extra actions (copy URL, open game) rendered after the detail. */
  trailing?: ReactNode;
  /** aria templates (`{label}` interpolated) — E33 localizable. */
  labels?: { play?: string; pause?: string };
  className?: string;
}

/**
 * Library audio row (E14-F6): controlled play/pause toggle + label. The
 * caller drives `playing` from its single shared audio element.
 */
export function AudioAssetRow({
  label,
  playing,
  onToggle,
  detail,
  trailing,
  labels,
  className,
}: AudioAssetRowProps): ReactElement {
  const toggleAria = (
    playing ? (labels?.pause ?? "Pause {label}") : (labels?.play ?? "Play {label}")
  ).replace("{label}", label);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-2xl border border-edge bg-surface-1 p-2 pe-3",
        className,
      )}
      data-playing={playing}
      data-testid="audio-asset-row"
    >
      <IconButton
        icon={playing ? Pause : Play}
        aria-label={toggleAria}
        aria-pressed={playing}
        variant="soft"
        onClick={onToggle}
        className={playing ? "border-cyan/50 bg-cyan/15 text-cyan" : undefined}
      />
      <AudioLines
        className={cn("size-4 shrink-0 text-cyan", playing && "fp-pulse")}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink" title={label}>
        {label}
      </span>
      {detail !== undefined && detail !== "" && (
        <span className="shrink-0 text-xs text-ink-muted">{detail}</span>
      )}
      {trailing}
    </div>
  );
}
