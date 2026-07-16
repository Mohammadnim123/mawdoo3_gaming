"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Gamepad2, Plus, Search } from "lucide-react";
import { Skeleton, cn } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { myGamesKey } from "./queryKeys";

export interface ProjectSwitcherProps {
  current: { id: string; title: string } | null;
  className?: string;
}

/**
 * Top-bar project dropdown (E14-F10): my games with client-side search,
 * current checked, "New project" on top.
 */
export function ProjectSwitcher({ current, className }: ProjectSwitcherProps): ReactElement {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const gamesQuery = useQuery({
    queryKey: myGamesKey(),
    queryFn: () => getServices().games.myGames({ limit: 50 }),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const games = useMemo(() => gamesQuery.data?.items ?? [], [gamesQuery.data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? games : games.filter((g) => g.title.toLowerCase().includes(q));
  }, [games, query]);

  const go = (to: Route): void => {
    setOpen(false);
    setQuery("");
    router.push(to);
  };

  return (
    <div className={cn("relative min-w-0", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "fp-hit flex h-9 min-w-0 max-w-44 items-center gap-1.5 rounded-2xl px-2.5 text-sm font-medium sm:max-w-60",
          "text-ink transition-colors duration-150 ease-out hover:bg-surface-1",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
        )}
        data-testid="project-switcher"
      >
        <Gamepad2 className="size-4 shrink-0 text-violet" aria-hidden />
        <span className="truncate">{current?.title ?? t.workspace.projects.newProject}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-muted transition-transform duration-150 ease-out", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute start-0 top-11 z-50 flex w-72 flex-col rounded-2xl border border-edge bg-surface-3 p-1.5"
        >
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.workspace.projects.searchProjects}
              aria-label={t.workspace.projects.searchProjects}
              className={cn(
                "h-9 w-full rounded-xl border border-edge bg-surface-2 ps-8 pe-2 text-sm text-ink",
                "placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet",
              )}
            />
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => go("/studio")}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-violet",
              "transition-colors duration-150 ease-out hover:bg-surface-2",
            )}
          >
            <Plus className="size-4" aria-hidden />
            {t.workspace.projects.newProject}
          </button>

          <div className="max-h-72 overflow-y-auto">
            {gamesQuery.isPending && (
              <div className="flex flex-col gap-1 p-1">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            )}
            {gamesQuery.isSuccess && filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-muted">
                {games.length === 0 ? t.workspace.projects.noProjects : t.workspace.projects.noMatch}
              </p>
            )}
            {filtered.map((game) => {
              const isCurrent = game.id === current?.id;
              return (
                <button
                  key={game.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  onClick={() => go(`/studio/${game.id}`)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start text-sm",
                    "transition-colors duration-150 ease-out hover:bg-surface-2",
                    isCurrent ? "text-ink" : "text-ink-secondary",
                  )}
                >
                  {game.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tiny CDN cover thumb
                    <img
                      src={game.cover_url}
                      alt=""
                      className="size-7 shrink-0 rounded-lg border border-edge object-cover"
                    />
                  ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-2">
                      <Gamepad2 className="size-3.5 text-ink-muted" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{game.title}</span>
                  {isCurrent && <Check className="size-4 shrink-0 text-violet" aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
