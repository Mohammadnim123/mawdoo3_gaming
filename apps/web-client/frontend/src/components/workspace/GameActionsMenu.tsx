"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import { IconButton, cn } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { DeleteGameDialog } from "./DeleteGameDialog";

export interface GameActionsMenuProps {
  game: { id: string; title: string };
}

/**
 * Workspace header overflow menu (v0.35): game-level owner actions. Today it's
 * just "Delete game" (behind a type-to-confirm dialog); the menu is the home
 * for future per-game actions (rename, duplicate…) so the header stays clean.
 * Hand-rolled dropdown (outside-click + Esc) to match ProjectSwitcher.
 */
export function GameActionsMenu({ game }: GameActionsMenuProps): ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="relative" ref={containerRef}>
      <IconButton
        icon={MoreVertical}
        aria-label={t.workspace.shell.moreActions}
        aria-expanded={open}
        aria-haspopup="menu"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        data-testid="game-actions-menu"
      />

      {open && (
        <div
          role="menu"
          className="absolute end-0 top-11 z-50 flex w-52 flex-col rounded-2xl border border-edge bg-surface-3 p-1.5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDeleteOpen(true);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-danger",
              "transition-colors duration-150 ease-out hover:bg-danger/10",
            )}
            data-testid="delete-game-action"
          >
            <Trash2 className="size-4" aria-hidden />
            {t.workspace.shell.deleteGame}
          </button>
        </div>
      )}

      <DeleteGameDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} game={game} />
    </div>
  );
}
