"use client";

import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "next/navigation";
import { Ghost, Search, SearchX } from "lucide-react";
import { EmptyState, GameCard, Input, Skeleton } from "@codply/ui";
import { genreLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SEARCH_MIN_LENGTH, useGameSearch } from "@/domain/hooks/useGameSearch";

const PAGE_LIMIT = 24;
/** URL mirroring is debounced so typing doesn't push a history entry per key. */
const URL_SYNC_MS = 300;

/**
 * The /search results screen: a large title-search box seeded from `?q=`, and
 * the same `fp-game-grid` of GameCards the feed/profile use. Reads and writes
 * the query to the URL (via `router.replace`, debounced) so results stay
 * shareable and survive back/forward. States: prompt-to-type, loading, empty,
 * results — all off the shared `useGameSearch` typeahead.
 */
export function SearchScreen(): ReactElement {
  const { t, f } = useI18n();
  const searchParams = useSearchParams();
  const qParam = searchParams.get("q") ?? "";

  const [raw, setRaw] = useState(qParam);
  const { items, isLoading, isError, query } = useGameSearch(raw, PAGE_LIMIT);

  // External navigation (header "see all", back/forward) seeds the field —
  // guarded so our own debounced writes (which land equal) never clobber typing.
  useEffect(() => {
    setRaw((prev) => (prev.trim() === qParam ? prev : qParam));
  }, [qParam]);

  // Mirror the field into the URL (debounced). Islands adaptation: the
  // reference uses router.replace, but Django owns routing so that shim would
  // trigger a full page load per keystroke — history.replaceState is the
  // same-document equivalent (the navigation shim notifies useSearchParams).
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = raw.trim();
      if (trimmed === qParam) return;
      window.history.replaceState(
        null,
        "",
        trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search",
      );
    }, URL_SYNC_MS);
    return () => clearTimeout(handle);
  }, [raw, qParam]);

  const showPrompt = raw.trim().length < SEARCH_MIN_LENGTH;

  const labelsFor = (genre: string | null): Record<string, string | undefined> => ({
    play: t.post.playGame,
    plays: t.game.plays,
    likes: t.game.likes,
    comments: t.game.comments,
    remixes: t.game.remixes,
    genre: genre ? genreLabel(t, genre) : undefined,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div className="flex flex-col gap-3">
        <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
          {t.meta.search}
        </h1>
        <div className="max-w-xl">
          <Input
            type="text"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder={t.search.placeholder}
            aria-label={t.search.label}
            leading={<Search className="size-4" aria-hidden />}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            data-testid="search-page-input"
          />
        </div>
      </div>

      {showPrompt ? (
        <EmptyState
          icon={Search}
          title={t.search.hintTitle}
          description={t.search.hintDescription}
        />
      ) : isLoading ? (
        <div className="fp-game-grid" data-testid="search-page-loading">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[16/12] w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState icon={Ghost} title={t.search.error} description={t.common.tryAgainLater} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={f.msg(t.search.noResults, { q: query })}
          description={t.search.hintDescription}
        />
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm text-ink-secondary">
            {f.msg(t.search.resultsFor, { q: query })}
          </h2>
          <div className="fp-game-grid">
            {items.map((game) => (
              <Link key={game.id} href={`/g/${game.slug}`} className="contents" scroll={false}>
                <GameCard game={game} labels={labelsFor(game.genre)} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
