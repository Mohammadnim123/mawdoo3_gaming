"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { Check, Copy, Download, FileCode2 } from "lucide-react";
import { color, font } from "../tokens";
import { cn } from "../lib/cn";
import { IconButton } from "../primitives/IconButton";

/** B44: CodeMirror language by file extension — anything else reads as HTML. */
export function languageFor(filename: string): LanguageSupport {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (ext === ".js" || ext === ".mjs") return javascript();
  if (ext === ".css") return css();
  if (ext === ".json") return json();
  return html();
}

/** Download mime by file extension (matches the published content types). */
export function mimeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (ext === ".js" || ext === ".mjs") return "text/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".json") return "application/json";
  return "text/html";
}

export interface CodePaneProps {
  /** File contents (the game's entry HTML or any bundle text file). */
  value: string;
  /** Enables editing; omit for the read-only MVP view. */
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** Shown in the header + used for downloads. */
  filename?: string;
  onCopy?: () => void;
  onDownload?: () => void;
  height?: string;
  /** User-visible strings — lifted to props so apps can localize (E33). */
  labels?: {
    copy?: string;
    copied?: string;
    download?: string;
    readOnly?: string;
  };
  className?: string;
}

/** One-Dark-ish CodeMirror theme mapped to Codply tokens (flat, no shadow). */
const codplyTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: color.canvas,
      color: color.textPrimary,
      fontSize: "13px",
      fontFamily: font.mono,
    },
    ".cm-content": { caretColor: color.cyan, fontFamily: font.mono },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: color.cyan },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: `${color.violet}40`,
    },
    ".cm-activeLine": { backgroundColor: `${color.surface1}` },
    ".cm-gutters": {
      backgroundColor: color.canvas,
      color: color.textMuted,
      border: "none",
      borderRight: `1px solid ${color.borderSubtle}`,
    },
    ".cm-activeLineGutter": { backgroundColor: color.surface1, color: color.textSecondary },
    ".cm-lineNumbers .cm-gutterElement": { fontFamily: font.mono },
    // Horizontal scroll (if any) stays inside the editor — never the page.
    ".cm-scroller": { overscrollBehaviorX: "contain" },
  },
  { dark: true },
);

/**
 * CodeMirror 6 source viewer/editor. Read-only in the MVP; editable mode is
 * used by the P1 "Save & Test" flow. Copy + download built in.
 */
export function CodePane({
  value,
  onChange,
  readOnly = onChange === undefined,
  filename = "index.html",
  onCopy,
  onDownload,
  height = "480px",
  labels,
  className,
}: CodePaneProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const extensions = useMemo(
    () => [
      languageFor(filename),
      codplyTheme,
      // E27 fix: with theme="none" the tokens fell back to CodeMirror's LIGHT
      // highlight palette on our dark canvas — barely-readable code. One Dark
      // token colors (not its chrome — ours stays token-driven) restore
      // contrast; {fallback: false} makes it win over the basicSetup default.
      syntaxHighlighting(oneDarkHighlightStyle, { fallback: false }),
      EditorView.lineWrapping,
    ],
    [filename],
  );

  // "Fill" mode (height="100%"): CodeMirror's `.cm-editor { height: 100% }`
  // only resolves against a DEFINITE parent height. The pane root is otherwise
  // auto-height, so 100% collapses to `auto` and the editor grows to fit ALL
  // content (a 400-line draft renders ~10,000px tall, overflowing the workspace
  // and scrolling the whole page while the agent streams). In fill mode we make
  // the root a bounded flex column so the editor area has a real height to fill
  // and scrolls INTERNALLY. Fixed-px heights keep their simple block layout.
  const fill = height === "100%";

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — no-op.
    }
  }, [onCopy, value]);

  const download = useCallback(() => {
    const blob = new Blob([value], { type: mimeFor(filename) });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    onDownload?.();
  }, [filename, onDownload, value]);

  return (
    // dir="ltr": code is an LTR island — the pane keeps its layout and
    // left-alignment even when the surrounding UI is RTL (E33).
    <div
      dir="ltr"
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-2xl border border-edge bg-canvas text-start",
        // Fill mode: bounded flex column so CodeMirror's height:100% has a real
        // height to resolve against and scrolls internally instead of growing.
        fill && "flex h-full min-h-0 flex-col",
        className,
      )}
      data-testid="code-pane"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge-subtle bg-surface-1 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <FileCode2 className="size-4 shrink-0 text-success" aria-hidden />
          <span className="truncate font-mono text-xs text-ink-secondary">{filename}</span>
          {readOnly && (
            <span className="rounded-full border border-edge bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
              {labels?.readOnly ?? "read-only"}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1">
          <IconButton
            icon={copied ? Check : Copy}
            aria-label={copied ? (labels?.copied ?? "Copied") : (labels?.copy ?? "Copy source")}
            variant="ghost"
            size="sm"
            onClick={() => void copy()}
            className={copied ? "text-success" : undefined}
          />
          <IconButton
            icon={Download}
            aria-label={labels?.download ?? "Download source"}
            variant="ghost"
            size="sm"
            onClick={download}
          />
        </span>
      </div>
      {/* Fill mode: a bounded flex-1 wrapper gives `.cm-editor { height:100% }`
          a definite box to fill (→ internal scroll). Fixed-px heights render the
          editor directly (its own height is already definite). */}
      <div className={cn(fill && "min-h-0 flex-1 overflow-hidden")}>
        <CodeMirror
          value={value}
          height={height}
          // Fill mode: the `height` prop only sizes `.cm-editor`; its own
          // react-codemirror container div stays auto, so `.cm-editor { height:
          // 100% }` can't resolve. Force the container to fill the bounded
          // wrapper too — now the chain is definite and CodeMirror scrolls.
          style={fill ? { height: "100%" } : undefined}
          theme="none"
          readOnly={readOnly}
          editable={!readOnly}
          extensions={extensions}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: !readOnly,
            searchKeymap: true,
          }}
        />
      </div>
    </div>
  );
}
