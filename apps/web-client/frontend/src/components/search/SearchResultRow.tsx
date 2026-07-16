"use client";

import type { ReactElement } from "react";
import type { FeedItem } from "@codply/contracts";
import { FALLBACK_GENRE_META, GenreChip, cn, genreMeta, resolveIcon, tint } from "@codply/ui";
import { genreLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";

export interface SearchResultRowProps {
  game: FeedItem;
  /** Stable option id — the combobox points `aria-activedescendant` at it. */
  id: string;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}

/**
 * One typeahead row: rounded cover thumbnail (tinted genre fallback when the
 * game has no cover) + truncated title + genre chip. A `role="option"` inside
 * the SearchMenu listbox — virtual focus is roving, so it never steals the
 * input's real focus (no tabIndex, click-to-select only).
 */
export function SearchResultRow({
  game,
  id,
  active,
  onHover,
  onSelect,
}: SearchResultRowProps): ReactElement {
  const { t } = useI18n();
  const meta = game.genre ? genreMeta(game.genre) : FALLBACK_GENRE_META;
  const FallbackIcon = resolveIcon(meta.icon);
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-testid="search-result-row"
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-start",
        "transition-colors duration-150 ease-out",
        active ? "bg-surface-2" : "bg-transparent",
      )}
    >
      <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        {game.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN cover thumb
          <img
            src={game.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-full items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${tint(meta.hue, 22)} 0%, ${tint(meta.hue, 6)} 100%)`,
            }}
          >
            <FallbackIcon className="size-4" style={{ color: meta.hue }} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{game.title}</span>
      {game.genre && (
        <GenreChip genre={game.genre} label={genreLabel(t, game.genre)} className="shrink-0" />
      )}
    </div>
  );
}
