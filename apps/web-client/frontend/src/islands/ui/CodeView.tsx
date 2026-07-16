// Code view: file tabs over a version's bundle source in CodeMirror
// (read-only — the engine owns builds; editing happens via chat edits).
// Ported from @codply/ui CodePane + EditorTabs. The editor stays dark in
// both themes by design, matching Codply.

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";

import { getJson } from "../lib/api";

interface SourcePayload {
  version_id: string;
  source_html: string;
  game_js: string;
  game_css: string;
}

const FILES = [
  { key: "game_js", name: "game.js", lang: javascript() },
  { key: "source_html", name: "index.html", lang: html() },
  { key: "game_css", name: "game.css", lang: css() },
] as const;

export function CodeView({
  sourceUrl,
  labels,
}: {
  sourceUrl: string | null;
  labels: { loading: string; empty: string; copy: string; copied: string };
}) {
  const [source, setSource] = useState<SourcePayload | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<(typeof FILES)[number]["key"]>("game_js");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSource(null);
    setError(false);
    if (!sourceUrl) return;
    let cancelled = false;
    getJson<SourcePayload>(sourceUrl)
      .then((payload) => {
        if (!cancelled) setSource(payload);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  if (!sourceUrl || error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-ink-muted)]">
        {labels.empty}
      </div>
    );
  }
  if (!source) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-ink-muted)]">
        <span className="fp-shimmer">{labels.loading}</span>
      </div>
    );
  }

  const activeFile = FILES.find((f) => f.key === active) ?? FILES[0];
  const value = source[activeFile.key] || "";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-edge-subtle)]">
      <div className="flex items-center gap-1 border-b border-[var(--color-edge-subtle)] bg-[var(--color-surface-1)] px-2 py-1.5">
        {FILES.filter((f) => source[f.key]).map((file) => (
          <button
            key={file.key}
            type="button"
            onClick={() => setActive(file.key)}
            className={`fp-hit rounded-lg px-3 py-1 font-mono text-xs ${
              active === file.key
                ? "bg-[var(--color-surface-3)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink-secondary)]"
            }`}
          >
            {file.name}
          </button>
        ))}
        <button
          type="button"
          className="fp-btn fp-btn-ghost fp-btn-sm ms-auto"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" dir="ltr">
        <CodeMirror
          value={value}
          theme={oneDark}
          readOnly
          extensions={[activeFile.lang]}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
        />
      </div>
    </div>
  );
}
