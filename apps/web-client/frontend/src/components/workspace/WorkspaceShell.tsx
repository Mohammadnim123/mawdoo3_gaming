"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import {
  Braces,
  Gamepad2,
  History,
  Image as ImageIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  SquareCode,
  type LucideIcon,
} from "lucide-react";
import { Button, IconButton, SegmentedControl, Tooltip, cn } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { AccountMenu } from "@/components/nav/TopBar";
import { useWorkspaceStore, type WorkspaceView } from "@/stores/workspace";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { GameActionsMenu } from "./GameActionsMenu";
import { useResizablePane } from "./useResizablePane";

const VIEW_ICONS: { value: WorkspaceView; icon: LucideIcon }[] = [
  { value: "game", icon: Gamepad2 },
  { value: "library", icon: ImageIcon },
  { value: "code", icon: SquareCode },
];

export interface WorkspaceShellProps {
  currentProject: { id: string; title: string } | null;
  /** Post is disabled (with a tooltip) until a live version exists (E14-F8). */
  canPost: boolean;
  onOpenHistory: () => void;
  historyDisabled?: boolean;
  onOpenPost: () => void;
  /** Left column: thread + composer (the shell owns collapse/pane logic). */
  chat: ReactNode;
  /** Right column views — ALL stay mounted; the shell hides inactive ones. */
  gameView: ReactNode;
  libraryView: ReactNode;
  codeView: ReactNode;
}

/**
 * The one-screen workspace frame (E14-F1): top bar (logo · project switcher ·
 * history · collapse · view tabs · Post · account), chat left (~420px, ≥lg)
 * with a collapse rail, view panel right. Below lg: one column with a snap
 * tab row `Chat · Game · Library · Code`.
 */
export function WorkspaceShell({
  currentProject,
  canPost,
  onOpenHistory,
  historyDisabled = false,
  onOpenPost,
  chat,
  gameView,
  libraryView,
  codeView,
}: WorkspaceShellProps): ReactElement {
  const { t, dir } = useI18n();
  const resize = useResizablePane(dir);
  const view = useWorkspaceStore((s) => s.view);
  const setView = useWorkspaceStore((s) => s.setView);
  const pane = useWorkspaceStore((s) => s.pane);
  const setPane = useWorkspaceStore((s) => s.setPane);
  const chatCollapsed = useWorkspaceStore((s) => s.chatCollapsed);
  const toggleChatCollapsed = useWorkspaceStore((s) => s.toggleChatCollapsed);
  const developerMode = useWorkspaceStore((s) => s.developerMode);
  const toggleDeveloperMode = useWorkspaceStore((s) => s.toggleDeveloperMode);

  const viewLabels: Record<WorkspaceView, string> = {
    game: t.workspace.shell.game,
    library: t.workspace.shell.library,
    code: t.workspace.shell.code,
  };
  const allViewOptions = VIEW_ICONS.map((option) => ({
    ...option,
    label: viewLabels[option.value],
  }));
  // E22/S10: the Code tab is developer territory — creators opt in.
  const viewOptions = developerMode
    ? allViewOptions
    : allViewOptions.filter((option) => option.value !== "code");

  const postButton = (
    <Button
      variant="gradient-cta"
      size="sm"
      onClick={onOpenPost}
      disabled={!canPost}
      leftIcon={<Send className="fp-flip-rtl size-4" aria-hidden />}
      data-testid="post-button"
    >
      {t.workspace.shell.post}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-edge-subtle px-2 sm:gap-2 sm:px-3">
        <Link
          href="/"
          aria-label={t.nav.codplyHome}
          className="fp-hit flex size-9 shrink-0 items-center justify-center rounded-2xl text-violet transition-colors duration-150 ease-out hover:bg-surface-1"
        >
          <Gamepad2 className="size-5" aria-hidden />
        </Link>
        <ProjectSwitcher current={currentProject} />
        <IconButton
          icon={History}
          aria-label={t.workspace.shell.history}
          variant="ghost"
          size="sm"
          onClick={onOpenHistory}
          disabled={historyDisabled}
          data-testid="history-button"
        />
        <IconButton
          icon={chatCollapsed ? PanelLeftOpen : PanelLeftClose}
          aria-label={chatCollapsed ? t.workspace.shell.expandChat : t.workspace.shell.collapseChat}
          aria-pressed={chatCollapsed}
          variant="ghost"
          size="sm"
          onClick={toggleChatCollapsed}
          className="fp-flip-rtl hidden lg:inline-flex"
          data-testid="collapse-chat-toggle"
        />

        {/* Center view tabs (≥lg — mobile uses the snap row below). */}
        <div className="hidden flex-1 items-center justify-center gap-1.5 lg:flex">
          <SegmentedControl
            aria-label={t.workspace.shell.workspaceView}
            options={viewOptions}
            value={view}
            onChange={setView}
          />
        </div>
        <span className="flex-1 lg:hidden" />

        <Tooltip
          content={
            developerMode ? t.workspace.shell.developerModeOn : t.workspace.shell.developerModeShow
          }
          side="bottom"
        >
          <IconButton
            icon={Braces}
            aria-label={
              developerMode
                ? t.workspace.shell.developerModeTurnOff
                : t.workspace.shell.developerModeTurnOn
            }
            aria-pressed={developerMode}
            variant="ghost"
            size="sm"
            onClick={toggleDeveloperMode}
            className={cn(developerMode && "text-violet")}
            data-testid="developer-mode-toggle"
          />
        </Tooltip>
        {canPost ? (
          postButton
        ) : (
          <Tooltip content={t.workspace.shell.publishFirst} side="bottom">
            {postButton}
          </Tooltip>
        )}
        {/* Per-game actions (delete, …) — only once a project exists. */}
        {currentProject !== null && <GameActionsMenu game={currentProject} />}
        <AccountMenu />
      </header>

      {/* Mobile snap tab row: Chat · Game · Library · Code (E14-F1). */}
      <nav
        aria-label={t.workspace.shell.workspaceSections}
        className="fp-scroll-x shrink-0 gap-1 border-b border-edge-subtle px-2 py-1 lg:hidden"
      >
        <MobileTab
          icon={MessageSquare}
          label={t.workspace.shell.chat}
          active={pane === "chat"}
          onClick={() => setPane("chat")}
        />
        {viewOptions.map((option) => (
          <MobileTab
            key={option.value}
            icon={option.icon}
            label={option.label}
            active={pane === "view" && view === option.value}
            onClick={() => setView(option.value)}
          />
        ))}
      </nav>

      {/* Panels */}
      <div className={cn("flex min-h-0 flex-1", resize.dragging && "cursor-col-resize select-none")}>
        {/* Chat column (or collapse rail on ≥lg). */}
        {chatCollapsed ? (
          <div className="hidden w-12 shrink-0 flex-col items-center gap-2 border-e border-edge-subtle py-3 lg:flex">
            <IconButton
              icon={PanelLeftOpen}
              aria-label={t.workspace.shell.expandChat}
              variant="ghost"
              size="sm"
              onClick={toggleChatCollapsed}
              className="fp-flip-rtl"
            />
            <MessageSquare className="size-4 text-ink-muted" aria-hidden />
          </div>
        ) : null}
        <section
          aria-label={t.workspace.shell.chat}
          style={{ "--chat-w": `${resize.width}px` } as React.CSSProperties}
          className={cn(
            "min-h-0 w-full flex-col lg:w-[var(--chat-w)] lg:shrink-0",
            pane === "chat" ? "flex" : "hidden",
            chatCollapsed ? "lg:hidden" : "lg:flex",
          )}
        >
          {chat}
        </section>

        {/* Drag-to-resize splitter (≥lg, expanded chat only). Thin divider
            with a wider grab zone; keyboard-nudge + double-click reset. */}
        {!chatCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t.workspace.shell.resizePanels}
            tabIndex={0}
            {...resize.separatorProps}
            className={cn(
              "hidden w-1.5 shrink-0 touch-none cursor-col-resize select-none border-s border-edge-subtle bg-transparent transition-colors lg:block",
              "hover:bg-violet/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet",
              resize.dragging && "bg-violet/60",
            )}
          />
        ) : null}

        {/* View panel — every view stays mounted (console keeps capturing,
            editor tabs persist); inactive ones are display:none. */}
        <section
          aria-label={t.workspace.shell.workspaceView}
          className={cn("min-h-0 min-w-0 flex-1 flex-col", pane === "view" ? "flex" : "hidden lg:flex")}
        >
          <div className={cn("min-h-0 flex-1", view === "game" ? "block" : "hidden")}>{gameView}</div>
          <div className={cn("min-h-0 flex-1", view === "library" ? "block" : "hidden")}>{libraryView}</div>
          <div className={cn("min-h-0 flex-1", view === "code" ? "block" : "hidden")}>{codeView}</div>
        </section>
      </div>
    </div>
  );
}

function MobileTab({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "fp-hit flex h-10 items-center gap-1.5 rounded-2xl px-3 text-sm font-medium",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
        active ? "bg-surface-2 text-ink" : "text-ink-secondary hover:text-ink",
      )}
    >
      <Icon className={cn("size-4", active && "text-violet")} aria-hidden />
      {label}
    </button>
  );
}
