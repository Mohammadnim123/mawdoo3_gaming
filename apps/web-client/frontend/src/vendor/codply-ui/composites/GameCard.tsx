"use client";

import type { ReactElement } from "react";
import { motion } from "framer-motion";
import { GitFork, Heart, MessageCircle, Play } from "lucide-react";
import { FALLBACK_GENRE_META, genreMeta, transition } from "../tokens";
import { cn } from "../lib/cn";
import { tint } from "../lib/tint";
import { Avatar } from "../primitives/Avatar";
import { GenreChip } from "./GenreChip";
import { StatPill } from "./StatPill";

export interface GameCardGame {
  id: string;
  slug: string;
  title: string;
  cover_url: string | null;
  /** null for unpublished drafts (no genre until first publish) — the chip
   * is hidden and tints fall back to the neutral hue. */
  genre: string | null;
  owner: { handle: string; display_name: string | null; avatar_url: string | null };
  play_count: number;
  remix_count: number;
  /** E16 engagement counts — rendered when present (social feeds). */
  like_count?: number;
  comment_count?: number;
}

export interface GameCardProps {
  game: GameCardGame;
  /** Link target for the game page (rendered as an anchor when set). */
  href?: string;
  onPlay?: (game: GameCardGame) => void;
  /** User-visible strings — lifted to props so apps can localize (E33). */
  labels?: {
    /** aria-label template for the play overlay — `{title}` interpolated. */
    play?: string;
    plays?: string;
    likes?: string;
    comments?: string;
    remixes?: string;
    /** Localized genre chip label (defaults to the token table). */
    genre?: string;
  };
  className?: string;
}

/**
 * Feed card: cover with hover play overlay (motion scale — flat, no shadow),
 * title, creator byline, genre chip and play/remix stats.
 */
export function GameCard({ game, href, onPlay, labels, className }: GameCardProps): ReactElement {
  const meta = game.genre ? genreMeta(game.genre) : FALLBACK_GENRE_META;
  const wrapperClass = cn(
    "group block overflow-hidden rounded-2xl border border-edge bg-surface-1",
    "transition-colors duration-200 ease-out hover:border-edge-strong",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
    className,
  );

  const body = (
    <>
      <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
        {game.cover_url ? (
          <img
            src={game.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            width={1024}
            height={576}
            className="size-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="size-full"
            style={{
              background: `linear-gradient(135deg, ${tint(meta.hue, 20)} 0%, ${tint(meta.hue, 5)} 100%)`,
            }}
          />
        )}
        {/* Hover play overlay */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-canvas/60 opacity-0",
            "transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          <button
            type="button"
            aria-label={(labels?.play ?? "Play {title}").replace("{title}", game.title)}
            onClick={(event) => {
              if (onPlay) {
                event.preventDefault();
                onPlay(game);
              }
            }}
            className="flex size-14 items-center justify-center rounded-full border border-edge-strong bg-surface-1 text-ink transition-transform duration-200 ease-out hover:scale-105 focus-visible:outline-2 focus-visible:outline-violet"
          >
            <Play className="ml-0.5 size-6" style={{ color: meta.hue }} aria-hidden />
          </button>
        </div>
        {game.genre !== null && (
          <div className="absolute start-2 top-2">
            <GenreChip genre={game.genre} label={labels?.genre} />
          </div>
        )}
      </div>

      {/* Works from 160px-wide cells: byline truncates, stats wrap under it
          instead of overflowing when the two can't share a row. */}
      <div className="flex min-w-0 flex-col gap-1.5 p-2.5 sm:gap-2 sm:p-3">
        <h3 className="truncate font-display text-sm font-semibold text-ink">{game.title}</h3>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar name={game.owner.display_name ?? game.owner.handle} src={game.owner.avatar_url} size="sm" />
            <span className="truncate text-xs text-ink-secondary" dir="ltr">
              @{game.owner.handle}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 sm:gap-3">
            <StatPill icon={Play} value={game.play_count} label={labels?.plays ?? "plays"} accent={meta.hue} />
            {game.like_count !== undefined && (
              <StatPill icon={Heart} value={game.like_count} label={labels?.likes ?? "likes"} />
            )}
            {game.comment_count !== undefined && (
              <StatPill icon={MessageCircle} value={game.comment_count} label={labels?.comments ?? "comments"} />
            )}
            <StatPill icon={GitFork} value={game.remix_count} label={labels?.remixes ?? "remixes"} />
          </span>
        </div>
      </div>
    </>
  );

  if (href) {
    return (
      <motion.a
        href={href}
        whileHover={{ scale: 1.02 }}
        transition={transition.base}
        data-testid="game-card"
        className={wrapperClass}
      >
        {body}
      </motion.a>
    );
  }
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={transition.base}
      data-testid="game-card"
      className={wrapperClass}
    >
      {body}
    </motion.div>
  );
}
