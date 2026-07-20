"use client";

import { create } from "zustand";
import type { BridgeConsolePayload } from "@codply/game-runtime";

export type StudioTab = "chat" | "code" | "versions" | "console" | "settings";

export interface ConsoleEntryState {
  id: string;
  level: BridgeConsolePayload["level"];
  message: string;
  ts?: number;
  stack?: string;
}

const MAX_CONSOLE_ENTRIES = 500;

interface StudioState {
  activeTab: StudioTab;
  /** Text pre-filled into the Chat composer ("Ask AI to fix" handoff). */
  chatPrefill: string | null;
  /** Runtime console entries captured from the GamePlayer bridge. */
  consoleEntries: ConsoleEntryState[];
  /** Version being previewed in the player (null = current). */
  previewVersionId: string | null;
  previewPlayUrl: string | null;
  setActiveTab: (tab: StudioTab) => void;
  prefillChat: (text: string) => void;
  consumeChatPrefill: () => string | null;
  pushConsoleEntry: (entry: BridgeConsolePayload) => void;
  clearConsole: () => void;
  setPreview: (versionId: string | null, playUrl: string | null) => void;
  reset: () => void;
}

let entrySeq = 0;

/** Ephemeral studio UI state (editor/console/stream glue) — Zustand per CONVENTIONS §7. */
export const useStudioStore = create<StudioState>((set, get) => ({
  activeTab: "chat",
  chatPrefill: null,
  consoleEntries: [],
  previewVersionId: null,
  previewPlayUrl: null,
  setActiveTab: (tab) => set({ activeTab: tab }),
  prefillChat: (text) => set({ chatPrefill: text, activeTab: "chat" }),
  consumeChatPrefill: () => {
    const text = get().chatPrefill;
    if (text !== null) set({ chatPrefill: null });
    return text;
  },
  pushConsoleEntry: (entry) => {
    entrySeq += 1;
    const next: ConsoleEntryState = {
      id: `c${entrySeq}`,
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
  setPreview: (versionId, playUrl) =>
    set({ previewVersionId: versionId, previewPlayUrl: playUrl }),
  reset: () =>
    set({
      activeTab: "chat",
      chatPrefill: null,
      consoleEntries: [],
      previewVersionId: null,
      previewPlayUrl: null,
    }),
}));
