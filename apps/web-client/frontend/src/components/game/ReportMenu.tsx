"use client";

import { useState, type ReactElement } from "react";
import { Flag } from "lucide-react";
import { ApiError } from "@codply/contracts";
import { Button, Dialog, IconButton, Textarea, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";

/** Flag-a-game dialog (`POST /games/{id}/report`). */
export function ReportMenu({ gameId }: { gameId: string }): ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const submit = async (): Promise<void> => {
    if (busy || reason.trim().length === 0) return;
    setBusy(true);
    try {
      await getServices().games.report(gameId, reason.trim());
      setOpen(false);
      setReason("");
      toast({ title: t.report.thanks, variant: "success" });
    } catch (error) {
      toast({
        title: t.report.failed,
        description: ApiError.isApiError(error) ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton
        icon={Flag}
        aria-label={t.report.reportGame}
        variant="ghost"
        onClick={() => setOpen(true)}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t.report.reportGame}
        description={t.report.description}
        closeLabel={t.ui.closeDialog}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => void submit()}
              loading={busy}
              disabled={reason.trim().length === 0}
              leftIcon={<Flag className="size-4" aria-hidden />}
            >
              {t.report.send}
            </Button>
          </div>
        }
      >
        <Textarea
          label={t.report.reason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          showCount
          rows={3}
          placeholder={t.report.reasonPlaceholder}
        />
      </Dialog>
    </>
  );
}
