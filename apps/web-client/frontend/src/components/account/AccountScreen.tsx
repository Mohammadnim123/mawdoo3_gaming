"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AtSign,
  Bookmark,
  Check,
  Gamepad2,
  Ghost,
  Globe,
  Hammer,
  Link2,
  Lock,
  LogOut,
  ShieldAlert,
  TimerReset,
  UserRoundPen,
  Zap,
} from "lucide-react";
import { ApiError, type GameVisibility } from "@codply/contracts";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  GameCard,
  Input,
  Progress,
  Skeleton,
  Textarea,
  useToast,
} from "@codply/ui";
import { genreLabel, type Messages } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useInvalidateMe, useMe } from "@/domain/hooks/useMe";
import { MY_SAVES_QUERY_KEY } from "@/domain/hooks/useSocial";
import { getServices } from "@/domain/services";
import { gameDestination } from "@/domain/gameDestination";
import { quotaRemaining } from "@/domain/quota";
import { useQuotaCountdown } from "@/components/create/QuotaChip";

const VISIBILITY_BADGES: Record<
  GameVisibility,
  { tone: "success" | "info" | "warning"; labelKey: keyof Messages["account"]; icon: typeof Globe }
> = {
  public: { tone: "success", labelKey: "visibilityPublic", icon: Globe },
  unlisted: { tone: "info", labelKey: "visibilityUnlisted", icon: Link2 },
  private: { tone: "warning", labelKey: "visibilityPrivate", icon: Lock },
};

/** Account hub: profile edit, quota, my games, logout, danger zone. */
export function AccountScreen(): ReactElement {
  const { t, f } = useI18n();
  const { data: me, isPending } = useMe();
  const invalidateMe = useInvalidateMe();
  const router = useRouter();
  const { toast } = useToast();
  const countdown = useQuotaCountdown();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"mine" | "saved">(
    searchParams.get("tab") === "saved" ? "saved" : "mine",
  );

  useEffect(() => {
    if (me) {
      setDisplayName(me.display_name ?? "");
      setBio(me.bio ?? "");
    }
  }, [me]);

  const myGamesQuery = useQuery({
    queryKey: ["my-games"],
    queryFn: () => getServices().games.myGames({ limit: 50 }),
    enabled: Boolean(me),
  });

  const savedQuery = useQuery({
    queryKey: MY_SAVES_QUERY_KEY,
    queryFn: () => getServices().social.mySaves({ limit: 50 }),
    enabled: Boolean(me) && tab === "saved",
  });

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={Ghost}
          title={t.account.notLoggedInTitle}
          description={t.account.notLoggedInDescription}
          action={
            <Link href="/login?next=/me">
              <Button variant="gradient-cta">{t.nav.logIn}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const saveProfile = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await getServices().games.updateMe({
        display_name: displayName.trim() || me.display_name || me.handle,
        bio: bio.trim(),
      });
      await invalidateMe();
      toast({ title: t.account.profileUpdated, variant: "success" });
    } catch (error) {
      toast({
        title: t.account.profileUpdateFailed,
        description: ApiError.isApiError(error) ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await getServices().auth.logout();
      await invalidateMe();
      router.push("/");
    } catch {
      toast({ title: t.nav.couldNotLogOut, variant: "error" });
    }
  };

  const remaining = quotaRemaining(me.quota);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:py-8">
      <h1 className="fp-title-page flex items-center gap-2 font-[family-name:var(--font-space-grotesk)] font-bold">
        <UserRoundPen className="size-6 text-violet" aria-hidden />
        {t.account.title}
      </h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-sm font-bold text-ink-secondary">{t.account.profile}</h2>
          <Input
            label={t.account.displayName}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
          />
          <Input
            label={t.account.handle}
            value={me.handle}
            disabled
            leading={<AtSign className="size-4" aria-hidden />}
            hint={t.account.handleHint}
            dir="ltr"
          />
          <Textarea
            label={t.account.bio}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={200}
            showCount
            rows={2}
            placeholder={t.account.bioPlaceholder}
          />
          <div className="flex items-center justify-between">
            <Button
              variant="solid"
              size="sm"
              onClick={() => void saveProfile()}
              loading={saving}
              leftIcon={<Check className="size-4" aria-hidden />}
            >
              {t.common.save}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void logout()}
              leftIcon={<LogOut className="size-4" aria-hidden />}
            >
              {t.nav.logOut}
            </Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-secondary">
            <Zap className="size-4 text-warning" aria-hidden />
            {t.account.dailyQuota}
          </h2>
          <p className="font-[family-name:var(--font-space-grotesk)] text-3xl font-bold">
            {remaining}
            <span className="text-base font-medium text-ink-muted">
              {" "}
              {f.msg(t.account.quotaLeft, { limit: me.quota.daily_limit })}
            </span>
          </p>
          <Progress
            value={me.quota.used_today}
            max={me.quota.daily_limit}
            gradient
            label={t.account.quotaUsedToday}
          />
          <Badge tone="neutral" leading={<TimerReset className="size-3" aria-hidden />}>
            {f.msg(t.account.resetsIn, { countdown })}
          </Badge>
        </Card>
      </div>

      <section className="flex flex-col gap-3" aria-label={t.account.myGamesSection}>
        <div className="flex items-center gap-2" role="group" aria-label={t.account.libraryTabs}>
          <Chip
            selected={tab === "mine"}
            onClick={() => setTab("mine")}
            leading={<Gamepad2 className="size-3.5" aria-hidden />}
          >
            {t.account.myGames}
          </Chip>
          <Chip
            selected={tab === "saved"}
            onClick={() => setTab("saved")}
            leading={<Bookmark className="size-3.5" aria-hidden />}
          >
            {t.account.saved}
          </Chip>
        </div>

        {tab === "mine" && (
          <>
            {myGamesQuery.isPending && <Skeleton className="h-48 w-full rounded-2xl" />}
            {myGamesQuery.isError && (
              <EmptyState
                icon={Gamepad2}
                title={t.account.gamesErrorTitle}
                description={t.account.gamesErrorDescription}
                action={
                  <Button variant="soft" onClick={() => void myGamesQuery.refetch()}>
                    {t.common.retry}
                  </Button>
                }
              />
            )}
            {myGamesQuery.isSuccess && myGamesQuery.data.items.length === 0 && (
              <EmptyState
                icon={Gamepad2}
                title={t.account.noGamesTitle}
                description={t.account.noGamesDescription}
                action={
                  <Link href="/create">
                    <Button variant="gradient-cta">{t.account.makeFirstGame}</Button>
                  </Link>
                }
              />
            )}
            <div className="fp-game-grid">
              {myGamesQuery.data?.items.map((game) => {
                // Unpublished projects (v0.4 drafts, failed first builds) have
                // no public page — their card continues in the studio instead.
                const destination = gameDestination(game, true);
                const badge = VISIBILITY_BADGES[game.visibility];
                const BadgeIcon = badge.icon;
                return (
                  <div key={game.id} className="relative">
                    <GameCard
                      game={{ ...game, genre: game.genre ?? "game" }}
                      href={destination.href ?? undefined}
                      labels={{
                        play: t.post.playGame,
                        plays: t.game.plays,
                        likes: t.game.likes,
                        comments: t.game.comments,
                        remixes: t.game.remixes,
                        genre: genreLabel(t, game.genre ?? "game"),
                      }}
                    />
                    <span className="absolute end-3 top-3">
                      {destination.kind === "studio" ? (
                        <Badge
                          tone="warning"
                          title={t.account.continueInStudio}
                          leading={<Hammer className="size-3" aria-hidden />}
                        >
                          {t.account.draft}
                        </Badge>
                      ) : (
                        <Badge tone={badge.tone} leading={<BadgeIcon className="size-3" aria-hidden />}>
                          {t.account[badge.labelKey]}
                        </Badge>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "saved" && (
          <>
            {savedQuery.isPending && <Skeleton className="h-48 w-full rounded-2xl" />}
            {savedQuery.isSuccess && savedQuery.data.items.length === 0 && (
              <EmptyState
                icon={Bookmark}
                title={t.account.noSavesTitle}
                description={t.account.noSavesDescription}
              />
            )}
            <div className="fp-game-grid">
              {savedQuery.data?.items.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  href={`/g/${game.slug}`}
                  labels={{
                    play: t.post.playGame,
                    plays: t.game.plays,
                    likes: t.game.likes,
                    comments: t.game.comments,
                    remixes: t.game.remixes,
                    genre: game.genre ? genreLabel(t, game.genre) : undefined,
                  }}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-danger">
          <ShieldAlert className="size-4" aria-hidden />
          {t.account.dangerZone}
        </h2>
        <p className="text-sm text-ink-secondary">
          {f.msg(t.account.deletionUnavailable, { endpoint: "DELETE /me" })}
        </p>
        <div>
          <Button variant="danger" disabled>
            {t.account.deleteAccount}
          </Button>
        </div>
      </Card>
    </div>
  );
}
