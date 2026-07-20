"use client";

import type { ReactElement } from "react";
import { ArrowRight, Search, SearchX } from "lucide-react";
import type { FeedItem } from "@codply/contracts";
import { Skeleton, cn } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SearchResultRow } from "./SearchResultRow";

export interface SearchMenuProps {
  /** DEBOUNCED term — shown in the empty message and the "see all" row. */
  query: string;
  items: FeedItem[];
  isLoading: boolean;
  isError: boolean;
  /** -1 = nothing highlighted; `items.length` = the "see all" row. */
  activeIndex: number;
  listboxId: string;
  /** `optionId(i)` — stable id per option for `aria-activedescendant`. */
  optionId: (index: number) => string;
  onHoverIndex: (index: number) => void;
  onSelectItem: (item: FeedItem) => void;
  onSelectSeeAll: () => void;
}

/**
 * The typeahead dropdown body: a `role="listbox"` of SearchResultRow options
 * plus a trailing "See all results" option. States: loading (skeleton rows),
 * error, empty ("No games match …"), and up to ~6 results. Keyboard roving
 * focus is driven by the parent combobox via `activeIndex` + `optionId`.
 */
export function SearchMenu({
  query,
  items,
  isLoading,
  isError,
  activeIndex,
  listboxId,
  optionId,
  onHoverIndex,
  onSelectItem,
  onSelectSeeAll,
}: SearchMenuProps): ReactElement {
  const { t, f } = useI18n();
  const seeAllIndex = items.length;

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={t.search.results}
      className="flex max-h-[min(70vh,26rem)] flex-col gap-0.5 overflow-y-auto p-1.5"
    >
      {isLoading ? (
        <div className="flex flex-col gap-1.5 p-1" aria-hidden data-testid="search-loading">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-1 py-1">
              <Skeleton className="size-10 shrink-0 rounded-lg" />
              <Skeleton className="h-4 flex-1 rounded-md" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <p className="px-3 py-6 text-center text-sm text-ink-muted">{t.search.error}</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-3 py-6 text-center text-sm text-ink-muted">
              <SearchX className="size-4 shrink-0" aria-hidden />
              {f.msg(t.search.noResults, { q: query })}
            </p>
          ) : (
            items.map((game, i) => (
              <SearchResultRow
                key={game.id}
                game={game}
                id={optionId(i)}
                active={activeIndex === i}
                onHover={() => onHoverIndex(i)}
                onSelect={() => onSelectItem(game)}
              />
            ))
          )}

          <div
            id={optionId(seeAllIndex)}
            role="option"
            aria-selected={activeIndex === seeAllIndex}
            data-testid="search-see-all"
            onMouseMove={() => onHoverIndex(seeAllIndex)}
            onClick={onSelectSeeAll}
            className={cn(
              "mt-0.5 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-violet",
              "transition-colors duration-150 ease-out",
              items.length > 0 && "border-t border-edge-subtle",
              activeIndex === seeAllIndex ? "bg-surface-2" : "bg-transparent",
            )}
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {f.msg(t.search.seeAllResults, { q: query })}
            </span>
            <ArrowRight className="fp-flip-rtl size-4 shrink-0" aria-hidden />
          </div>
        </>
      )}
    </div>
  );
}
