import type { ReactElement } from "react";
import { genreMeta } from "../tokens";
import { resolveIcon } from "../lib/icons";
import { Badge } from "../primitives/Badge";

export interface GenreChipProps {
  genre: string;
  /** Localized display label; defaults to the token table (E33). */
  label?: string;
  className?: string;
}

/** Genre badge — hue + lucide icon from GENRE_HUES (fallback-safe). */
export function GenreChip({ genre, label, className }: GenreChipProps): ReactElement {
  const meta = genreMeta(genre);
  const Icon = resolveIcon(meta.icon);
  return (
    <Badge accent={meta.hue} className={className} leading={<Icon className="size-3" aria-hidden />}>
      {label ?? meta.label}
    </Badge>
  );
}
