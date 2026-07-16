"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { BridgeConsolePayload } from "@codply/game-runtime";
import type { ConsoleEntryState } from "./studio";

export type WorkspaceView = "game" | "library" | "code";
/** <lg only: which column is on screen (chat vs the active view). */
export type WorkspacePane = "chat" | "view";

const MAX_CONSOLE_ENTRIES = 500;

interface WorkspaceState {
  view: WorkspaceView;
  pane: WorkspacePane;
  /** ≥lg: chat panel collapsed to a slim rail. Persisted per session (E14-F1). */
  chatCollapsed: boolean;
  /** E22/S10: the Code tab is a developer tool — hidden until opted in.
   * Persisted like the collapse pref; creators who never want code never see it. */
  developerMode: boolean;
  /** Runtime console entries from the GamePlayer bridge (Code view dock). */
  consoleEntries: ConsoleEntryState[];
  /** Version URL currently loaded in the player (null = nothing mounted). */
  mountedPlayUrl: string | null;
  /**
   * E40: LIVE screenshot fn for the mounted game (published by the player while
   * ready, null otherwise). The composer prefers it — it captures EXACTLY what
   * the player sees — and falls back to a server render when it's null.
   * Ephemeral, never persisted.
   */
  captureGame: (() => Promise<string | null>) | null;
  setView: (view: WorkspaceView) => void;
  setPane: (pane: WorkspacePane) => void;
  toggleChatCollapsed: () => void;
  toggleDeveloperMode: () => void;
  pushConsoleEntry: (entry: BridgeConsolePayload) => void;
  clearConsole: () => void;
  setMountedPlayUrl: (url: string | null) => void;
  setCaptureGame: (capture: (() => Promise<string | null>) | null) => void;
  /** Per-project state reset on workspace switch (collapse pref survives). */
  reset: () => void;
}

let entrySeq = 0;

/** Ephemeral workspace UI state (CONVENTIONS §7 — Zustand, not URL). */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      view: "game",
      pane: "chat",
      chatCollapsed: false,
      developerMode: false,
      consoleEntries: [],
      mountedPlayUrl: null,
      captureGame: null,
      setView: (view) => set({ view, pane: "view" }),
      setPane: (pane) => set({ pane }),
      toggleChatCollapsed: () => set({ chatCollapsed: !get().chatCollapsed }),
      toggleDeveloperMode: () => {
        const { developerMode, view } = get();
        // turning developer mode OFF while on Code jumps back to the game
        set({
          developerMode: !developerMode,
          ...(developerMode && view === "code" ? { view: "game" } : {}),
        });
      },
      pushConsoleEntry: (entry) => {
        entrySeq += 1;
        const next: ConsoleEntryState = {
          id: `w${entrySeq}`,
          level: entry.level,
          message: entry.message,
          ts: entry.ts,
          stack: entry.stack,
        };
        set((state) => ({
          consoleEntries: [...state.consoleEntries.slice(-(MAX_CONSOLE_ENTRIES - 1)), next],
        }));
      },
      clearConsole: () => set({ consoleEntries: [] }),
      setMountedPlayUrl: (url) => set({ mountedPlayUrl: url }),
      setCaptureGame: (capture) => set({ captureGame: capture }),
      reset: () =>
        set({
          view: "game",
          pane: "chat",
          consoleEntries: [],
          mountedPlayUrl: null,
          captureGame: null,
        }),
    }),
    {
      name: "fp-workspace-ui",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        chatCollapsed: state.chatCollapsed,
        developerMode: state.developerMode,
      }),
    },
  ),
);
