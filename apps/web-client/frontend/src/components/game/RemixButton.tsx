"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, type ReactElement } from "react";
import { GitFork } from "lucide-react";
import { ApiError, type GameDetail } from "@codply/contracts";
import { Button, Dialog, Textarea, useToast } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { getServices } from "@/domain/services";

export interface RemixButtonProps {
  game: GameDetail;
  onRemixed: (jobId: string | null, newGameId: string) => void;
}

/**
 * Remix = the growth loop. Auth-gated (anonymous → /login with return path);
 * confirmation dialog takes an optional first change request.
 */
export function RemixButton({ game, onRemixed }: RemixButtonProps): ReactElement {
  const { t, f } = useI18n();
  const { data: me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const startRemix = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await getServices().games.remix(game.id, message.trim() || undefined);
      setOpen(false);
      onRemixed(result.job_id ?? null, result.new_game_id);
    } catch (error) {
      toast({
        title: t.remix.failed,
        description: ApiError.isApiError(error) ? error.message : t.common.tryAgainLater,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleClick = (): void => {
    if (!me) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        variant="gradient-cta"
        size="sm"
        onClick={handleClick}
        leftIcon={<GitFork className="size-4" aria-hidden />}
      >
        {t.remix.cta}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={f.msg(t.remix.dialogTitle, { title: game.title })}
        description={t.remix.dialogDescription}
        closeLabel={t.ui.closeDialog}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="gradient-cta"
              onClick={() => void startRemix()}
              loading={busy}
              leftIcon={<GitFork className="size-4" aria-hidden />}
            >
              {t.remix.create}
            </Button>
          </div>
        }
      >
        <Textarea
          label={t.remix.firstChange}
          placeholder={t.remix.firstChangePlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          showCount
          rows={3}
        />
      </Dialog>
    </>
  );
}
