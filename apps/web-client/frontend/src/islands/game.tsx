// Entry: the public game page island (#game-island, props {slug}).
//
// The reference game page is a server component that fetches the detail and
// renders <GameScreen game currentVersion/>; here Django serves the shell
// (head/OG/JSON-LD + a skeleton) and this island fetches the same contract
// client-side, then mounts the verbatim GameScreen.
import { useEffect, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { GameScreen } from "@/components/game/GameScreen";
import { ApiUnreachable } from "@/components/common/ApiUnreachable";
import { mountIsland } from "./lib/mount";

/** Mirrors the server-rendered pending markup (templates/game/detail.html)
 * so hydration doesn't flash: player letterbox + title + byline lines. */
function GamePageSkeleton(): ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-3 sm:gap-5 sm:py-6 md:py-10">
      <Skeleton className="aspect-[16/10] max-h-[70dvh] w-full rounded-2xl" />
      <Skeleton className="h-8 w-2/3 rounded-2xl" />
      <Skeleton className="h-5 w-48 rounded-2xl" />
    </div>
  );
}

function GameIsland({ slug }: { slug: string }): ReactElement | null {
  const { t } = useI18n();
  const gameQuery = useQuery({
    queryKey: ["game", slug],
    queryFn: () => getServices().games.gameBySlug(slug),
  });
  const { data: me } = useMe();
  const game = gameQuery.data;

  // v0.4 draft projects have no public page until their first publish — the
  // OWNER continues in the studio (the reference server page redirects too).
  // Strangers never get here: Django 404s non-live games server-side.
  const versionless = game !== undefined && game.current_version === null;
  const isOwner = game !== undefined && me?.handle === game.owner.handle;
  useEffect(() => {
    if (versionless && isOwner && game) window.location.replace(`/studio/${game.id}`);
  }, [versionless, isOwner, game]);

  if (gameQuery.isPending) return <GamePageSkeleton />;
  if (gameQuery.isError) return <ApiUnreachable />;
  if (game === undefined) return null;
  if (game.current_version === null) {
    // Owner is being redirected to the studio; anyone else sees the notice.
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-3 sm:gap-5 sm:py-6 md:py-10">
        <p className="text-sm text-ink-secondary">{t.overlay.noPublishedVersion}</p>
      </div>
    );
  }
  return <GameScreen game={game} currentVersion={game.current_version} />;
}

mountIsland("game-island", (props: { slug?: string }) =>
  props.slug ? <GameIsland slug={props.slug} /> : <GamePageSkeleton />,
);
