"use client";

import { useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Gamepad2, Globe, Link2, PartyPopper, Send, Share2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ApiError, type GameDetail, type GameVisibility } from "@codply/contracts";
import { Button, Chip, Dialog, ShareBar, Textarea, cn, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { workspaceGameKey } from "./queryKeys";

const POST_VISIBILITY_ICONS: { value: GameVisibility; icon: LucideIcon }[] = [
  { value: "public", icon: Globe },
  { value: "unlisted", icon: Link2 },
];

const CAPTION_MAX = 500;

export interface PostDialogProps {
  open: boolean;
  onClose: () => void;
  game: GameDetail;
  /** Resolution key of the workspace-game query. */
  gameKey: string;
}

/**
 * The POST composer (E21): a real social post moment — say something about
 * your game, pick visibility, hit "Post to feed". Success flips to the share
 * state (link + intents). Reposting just updates caption/visibility.
 */
export function PostDialog({ open, onClose, game, gameKey }: PostDialogProps): ReactElement {
  const { t, f } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [caption, setCaption] = useState(game.description ?? "");
  const [visibility, setVisibility] = useState<GameVisibility>(
    game.visibility === "unlisted" ? "unlisted" : "public",
  );
  const [posted, setPosted] = useState(false);
  const shareUrl =
    typeof window === "undefined" ? `/g/${game.slug}` : `${window.location.origin}/g/${game.slug}`;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const post = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await getServices().games.patchGame(game.id, {
        visibility,
        description: caption.trim() || null,
      });
      setPosted(true);
      toast({
        title:
          visibility === "public"
            ? t.workspace.postDialog.postedToFeed
            : t.workspace.postDialog.linkOnlyOn,
        variant: "success",
      });
      void queryClient.invalidateQueries({ queryKey: workspaceGameKey(gameKey) });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch (error) {
      toast({
        title: t.workspace.postDialog.postFailed,
        description: ApiError.isApiError(error) ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const nativeShare = async (): Promise<void> => {
    try {
      await navigator.share({ title: game.title, url: shareUrl });
    } catch {
      // Dismissed / unsupported — the ShareBar covers the rest.
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={posted ? t.workspace.postDialog.titlePosted : t.workspace.postDialog.title}
      description={
        posted ? t.workspace.postDialog.descriptionPosted : t.workspace.postDialog.description
      }
      closeLabel={t.ui.closeDialog}
    >
      <div className="flex flex-col gap-4">
        {!posted && (
          <>
            <div>
              <label
                htmlFor="post-caption"
                className="mb-2 block text-sm font-medium text-ink-secondary"
              >
                {t.workspace.postDialog.caption}
              </label>
              <Textarea
                id="post-caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value.slice(0, CAPTION_MAX))}
                placeholder={f.msg(t.workspace.postDialog.captionPlaceholder, { title: game.title })}
                rows={3}
                data-testid="post-caption"
              />
              <p className="mt-1 text-end text-xs text-ink-muted">
                {caption.length}/{CAPTION_MAX}
              </p>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink-secondary">
                {t.workspace.postDialog.visibility}
              </legend>
              <div className="flex flex-wrap gap-2">
                {POST_VISIBILITY_ICONS.map(({ value, icon: Icon }) => (
                  <Chip
                    key={value}
                    selected={visibility === value}
                    disabled={saving}
                    onClick={() => setVisibility(value)}
                    leading={<Icon className="size-3.5" aria-hidden />}
                  >
                    {value === "public" ? t.account.visibilityPublic : t.account.visibilityUnlisted}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {visibility === "public"
                  ? t.workspace.postDialog.publicHint
                  : t.workspace.postDialog.unlistedHint}
              </p>
            </fieldset>
          </>
        )}

        {/* OG-style preview of what gets posted/shared. */}
        <div className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3">
          {game.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- CDN cover preview
            <img
              src={game.cover_url}
              alt=""
              className="size-14 shrink-0 rounded-xl border border-edge object-cover"
            />
          ) : (
            <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-edge bg-surface-3">
              <Gamepad2 className="size-6 text-violet" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{game.title}</p>
            <p className={cn("truncate font-mono text-xs text-ink-muted")} dir="ltr">
              {shareUrl}
            </p>
          </div>
        </div>

        {!posted ? (
          <Button
            variant="gradient-cta"
            onClick={() => void post()}
            disabled={saving}
            leftIcon={<Send className="fp-flip-rtl size-4" aria-hidden />}
            data-testid="post-to-feed"
          >
            {visibility === "public"
              ? t.workspace.postDialog.postToFeed
              : t.workspace.postDialog.saveGetLink}
          </Button>
        ) : (
          <>
            <p className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              <PartyPopper className="size-4 shrink-0" aria-hidden />
              {visibility === "public"
                ? t.workspace.postDialog.onTheFeed
                : t.workspace.postDialog.anyoneWithLink}
            </p>
            <ShareBar
              url={shareUrl}
              title={f.msg(t.workspace.postDialog.shareTitle, { title: game.title })}
              labels={{
                copyLink: t.common.copyLink,
                copied: t.ui.copiedExclaim,
                postOnX: t.ui.postOnX,
                whatsApp: t.ui.whatsApp,
                defaultText: t.ui.shareDefaultText,
              }}
            />
            {canNativeShare && (
              <Button
                variant="soft"
                onClick={() => void nativeShare()}
                leftIcon={<Share2 className="size-4" aria-hidden />}
              >
                {t.workspace.postDialog.shareNative}
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
