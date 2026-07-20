"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { ApiError } from "@codply/contracts";
import { Button, Dialog, Input, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { myGamesKey } from "./queryKeys";

export interface DeleteGameDialogProps {
  open: boolean;
  onClose: () => void;
  game: { id: string; title: string };
}

/**
 * Guarded game deletion (v0.35): a destructive action gated behind
 * type-to-confirm — the creator must type the localized DELETE word before the
 * button arms. On success the game is soft-deleted server-side (drops from every
 * feed/profile query + 410 on the CDN), the my-games/feed caches are
 * invalidated, and we route home (the game no longer resolves).
 */
export function DeleteGameDialog({ open, onClose, game }: DeleteGameDialogProps): ReactElement {
  const { t, f } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [deleting, setDeleting] = useState(false);

  const confirmWord = t.workspace.deleteDialog.confirmWord;
  const armed = value.trim().toLowerCase() === confirmWord.toLowerCase();

  // Clear the typed word whenever the dialog (re)opens, so a re-open never
  // starts pre-armed from a prior attempt.
  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const close = (): void => {
    if (deleting) return; // don't drop the modal mid-request
    onClose();
  };

  const confirm = async (): Promise<void> => {
    if (!armed || deleting) return;
    setDeleting(true);
    try {
      await getServices().games.deleteGame(game.id);
      toast({
        title: f.msg(t.workspace.deleteDialog.deleted, { title: game.title }),
        variant: "success",
      });
      void queryClient.invalidateQueries({ queryKey: myGamesKey() });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      // The game is gone — leave the (now-404) workspace for the feed.
      router.push("/feed");
    } catch (error) {
      toast({
        title: t.workspace.deleteDialog.failed,
        description: ApiError.isApiError(error) ? error.message : undefined,
        variant: "error",
      });
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t.workspace.deleteDialog.title}
      description={f.msg(t.workspace.deleteDialog.description, { title: game.title })}
      closeLabel={t.ui.closeDialog}
      footer={
        <>
          <Button variant="soft" onClick={close} disabled={deleting}>
            {t.workspace.deleteDialog.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            disabled={!armed || deleting}
            loading={deleting}
            data-testid="confirm-delete-game"
          >
            {deleting ? t.workspace.deleteDialog.deleting : t.workspace.deleteDialog.confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t.workspace.deleteDialog.warning}</span>
        </p>
        <Input
          label={f.msg(t.workspace.deleteDialog.confirmLabel, { word: confirmWord })}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && armed) void confirm();
          }}
          placeholder={confirmWord}
          data-autofocus
          autoComplete="off"
          spellCheck={false}
          disabled={deleting}
          data-testid="delete-confirm-input"
        />
      </div>
    </Dialog>
  );
}
