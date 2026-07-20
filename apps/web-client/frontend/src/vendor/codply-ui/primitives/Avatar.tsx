"use client";

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { cn } from "../lib/cn";
import { tint } from "../lib/tint";

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizes = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
  xl: "size-24 text-3xl",
} as const;

/**
 * Colorful deterministic hue per name for initials fallbacks — CSS token
 * references (never raw hex) so the palette follows the active theme (E32).
 * Order matches the pre-token hex list so name→color stays stable.
 */
const AVATAR_HUES = [
  "var(--color-violet)",
  "var(--color-cyan)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-info)",
  "var(--color-lime)",
  "var(--color-orange)",
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

export function Avatar({ name, src, size = "md", className }: AvatarProps): ReactElement {
  const [failed, setFailed] = useState(false);
  const hue = useMemo(() => {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]!;
  }, [name]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setFailed(true)}
        className={cn("rounded-full border border-edge object-cover", sizes[size], className)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      style={{ backgroundColor: tint(hue, 15), color: hue, borderColor: tint(hue, 35) }}
      className={cn(
        "inline-flex items-center justify-center rounded-full border font-medium",
        sizes[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
