"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { GitFork, Play, Split, Wrench } from "lucide-react";
import type { CurrentVersion, GameDetail } from "@codply/contracts";
import { normalizeOrigin } from "@codply/game-runtime";
import { Avatar, GenreChip, ShareBar, StatPill, useToast } from "@codply/ui";
import { genreLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { GamePlayerFrame } from "./GamePlayerFrame";
import { RemixButton } from "./RemixButton";
import { ReportMenu } from "./ReportMenu";
import { ViewCodeDialog } from "./ViewCodeDialog";
import { OverlayActions } from "@/components/feed/PlayerOverlay";
import { FollowButton } from "@/components/social/FollowButton";
import { CommentThread } from "@/components/comments";

/** Public game page body: player center-stage, byline, stats, actions. */
export function GameScreen({
  game,
  currentVersion,
}: {
  game: GameDetail;
  /** Non-null by contract: the page 404s version-less drafts (v0.4). */
  currentVersion: CurrentVersion;
}): ReactElement {
  const { t } = useI18n();
  const { data: me } = useMe();
  const router = useRouter();
  const { toast } = useToast();
  const [shareUrl, setShareUrl] = useState(`/g/${game.slug}`);
  const isOwner = me?.handle === game.owner.handle;

  // window is unavailable during SSR — upgrade to the absolute URL on mount.
  useEffect(() => {
    setShareUrl(new URL(`/g/${game.slug}`, window.location.origin).toString());
  }, [game.slug]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-3 sm:gap-5 sm:py-6 md:py-10">
      {/* Player first, full-bleed on phones: negative margins eat the page
          padding and --fp-player-radius squares the corners edge-to-edge. */}
      <GamePlayerFrame
        gameId={game.id}
        playUrl={currentVersion.play_url}
        cdnOrigin={normalizeOrigin(currentVersion.play_url) ?? ""}
        title={game.title}
        playSource="direct"
        className="-mx-4 [--fp-player-radius:0px] sm:mx-0 sm:[--fp-player-radius:16px]"
      />

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="fp-title-page break-words font-[family-name:var(--font-space-grotesk)] font-bold">
              {game.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/u/${game.owner.handle}`}
                className="flex items-center gap-2 text-sm text-ink-secondary transition-colors duration-150 ease-out hover:text-ink"
              >
                <Avatar
                  name={game.owner.display_name ?? game.owner.handle}
                  src={game.owner.avatar_url ?? undefined}
                  size="sm"
                />
                {game.owner.display_name ?? game.owner.handle}
              </Link>
              <FollowButton handle={game.owner.handle} />
              <GenreChip genre={game.genre ?? "game"} label={genreLabel(t, game.genre ?? "game")} />
              <StatPill icon={Play} value={game.play_count} label={t.game.plays} />
              <StatPill icon={GitFork} value={game.remix_count} label={t.game.remixes} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RemixButton
              game={game}
              onRemixed={(jobId, newGameId) => {
                if (jobId) {
                  router.push(`/create?job=${encodeURIComponent(jobId)}`);
                } else {
                  toast({ title: t.game.remixCreated, variant: "success" });
                  router.push("/me");
                }
                void newGameId;
              }}
            />
            <ReportMenu gameId={game.id} />
          </div>
        </div>

        {game.remixed_from && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <Split className="size-3.5 text-success" aria-hidden />
            {t.game.remixedFrom}{" "}
            <Link
              href={`/g/${game.remixed_from.slug}`}
              className="font-medium text-ink-secondary underline-offset-2 transition-colors duration-150 ease-out hover:text-ink hover:underline"
            >
              {game.remixed_from.title}
            </Link>
          </p>
        )}

        {game.description && <p className="text-sm text-ink-secondary">{game.description}</p>}

        {/* E16-F9: the post's engagement row — like/save/share/comments live here too. */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <OverlayActions
            game={game}
            onComments={() =>
              document.getElementById("comments")?.scrollIntoView({ behavior: "smooth" })
            }
          />
        </div>
      </header>

      <ShareBar
        url={shareUrl}
        title={game.title}
        labels={{
          copyLink: t.common.copyLink,
          copied: t.ui.copiedExclaim,
          postOnX: t.ui.postOnX,
          whatsApp: t.ui.whatsApp,
          defaultText: t.ui.shareDefaultText,
        }}
      />

      <section id="comments" aria-label={t.game.comments} className="border-t border-edge-subtle pt-4">
        <h2 className="mb-3 font-[family-name:var(--font-space-grotesk)] text-lg font-bold">
          {t.game.comments}
        </h2>
        <CommentThread gameId={game.id} ownerHandle={game.owner.handle} />
      </section>

      <footer className="flex flex-wrap items-center gap-4 border-t border-edge-subtle pt-4 text-sm">
        <ViewCodeDialog gameId={game.id} versionId={currentVersion.id} title={game.title} />
        {isOwner && (
          <Link
            href={`/studio/${game.id}`}
            className="fp-hit flex items-center gap-1.5 font-medium text-violet transition-colors duration-150 ease-out hover:text-cyan"
          >
            <Wrench className="size-4" aria-hidden />
            {t.game.openStudio}
          </Link>
        )}
      </footer>
    </div>
  );
}
