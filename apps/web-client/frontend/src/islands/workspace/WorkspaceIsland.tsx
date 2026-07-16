// The live generation workspace island (Codply WorkspaceScreen parity on our
// Django BFF contract): chat pane (prompt bubble → generation card → clarify
// cards → composer) beside a Game / Code / Versions view, all riding the
// same-origin session.

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getJson, postJson } from "../lib/api";
import { useJobStream } from "../lib/jobStream";
import type { ClarifyQuestion, Labels, VersionItem } from "../lib/types";
import { GamePlayer, type GameMessage } from "../runtime/GamePlayer";
import { ClarifyCards } from "../ui/ClarifyCards";
import { ConsolePane, type ConsoleEntry } from "../ui/ConsolePane";
import { StepTimeline } from "../ui/StepTimeline";
import { VersionTree } from "../ui/VersionTree";

// CodeMirror is heavy; load it only when the Code tab is opened.
const CodeView = lazy(() =>
  import("../ui/CodeView").then((m) => ({ default: m.CodeView })),
);

export interface WorkspaceProps {
  csrfToken: string;
  locale: string;
  labels: Labels;
  game: {
    id: string;
    title: string;
    prompt: string;
    isLive: boolean;
    slug: string;
  };
  job: {
    refId: string;
    status: string;
    prompt: string;
    error: string | null;
    questions: ClarifyQuestion[];
  } | null;
  jobUrls: { stream: string; status: string; answers: string; cancel: string } | null;
  urls: {
    chat: string;
    versions: string;
    rollback: string;
    jobBase: string; // /studio/jobs/ — island appends <refId>/<action>
  };
  player: { src: string; origin: string } | null;
}

type RightTab = "game" | "code" | "versions";

const ACTIVE_STATUSES = new Set(["queued", "running", "awaiting_input"]);

export function WorkspaceIsland(props: WorkspaceProps) {
  const t = props.labels;
  const [job, setJob] = useState(props.job);
  const [jobUrls, setJobUrls] = useState(props.jobUrls);
  const jobIsActive = job !== null && ACTIVE_STATUSES.has(job.status);
  const stream = useJobStream(jobIsActive && jobUrls ? jobUrls.stream : null);

  const [tab, setTab] = useState<RightTab>("game");
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<VersionItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const consoleSeq = useRef(0);
  const finalizedRef = useRef(false);

  const refreshVersions = useCallback(() => {
    getJson<{ items: VersionItem[]; current_version_id: string | null }>(props.urls.versions)
      .then((payload) => {
        setVersions(payload.items);
        setCurrentVersionId(payload.current_version_id);
      })
      .catch(() => undefined);
  }, [props.urls.versions]);

  useEffect(() => {
    if (props.game.isLive) refreshVersions();
  }, [props.game.isLive, refreshVersions]);

  // Snapshot fallback: if the page loaded while the job was already awaiting
  // input, the questions came server-rendered (no SSE replay needed).
  const questions =
    stream.questions.length > 0 ? stream.questions : job?.questions ?? [];
  const awaiting =
    !cancelled &&
    jobIsActive &&
    (stream.phase === "awaiting_input" || job?.status === "awaiting_input") &&
    questions.length > 0;

  // Terminal handling: confirm via the status endpoint (which also finalizes
  // the product record). Auto-reload into the live workspace only when the
  // creator isn't mid-thought — a draft in the composer must never be lost.
  //
  // finalizedRef re-arms ONLY when the (new) stream actually resets to
  // 'connecting' — never at send time. Right after a follow-up edit swaps
  // jobUrls, this effect re-runs against the PREVIOUS job's terminal phase
  // (the hook's reset lands a render later); acting then would instantly
  // finalize the brand-new job against stale state.
  const inputRef = useRef(input);
  inputRef.current = input;
  const [readyToReveal, setReadyToReveal] = useState(false);
  useEffect(() => {
    if (stream.phase === "connecting") finalizedRef.current = false;
  }, [stream.phase]);
  useEffect(() => {
    if (!jobUrls || finalizedRef.current) return;
    if (stream.phase !== "done" && stream.phase !== "failed") return;
    finalizedRef.current = true;
    if (stream.phase === "failed") {
      // Unlock the composer; the failure card renders from stream state.
      setJob((j) => (j ? { ...j, status: "failed" } : j));
      return;
    }
    getJson<{ status: string }>(jobUrls.status)
      .catch(() => undefined)
      .finally(() => {
        setJob((j) => (j ? { ...j, status: "succeeded" } : j));
        setReadyToReveal(true);
        if (!inputRef.current.trim()) {
          window.setTimeout(() => window.location.reload(), 900);
        }
      });
  }, [stream.phase, jobUrls]);

  // Poll fallback: the SSE stream can die without a terminal event (engine
  // restart, dropped proxy connection). The status endpoint both reconciles
  // with the engine server-side and settles the UI here.
  useEffect(() => {
    if (!jobIsActive || !jobUrls) return undefined;
    const interval = window.setInterval(() => {
      getJson<{ status: string; error: string | null; questions?: ClarifyQuestion[] }>(
        jobUrls.status,
      )
        .then((snap) => {
          if (snap.status === "failed") {
            setJob((j) => (j ? { ...j, status: "failed", error: snap.error } : j));
          } else if (snap.status === "cancelled" || snap.status === "expired") {
            setJob((j) => (j ? { ...j, status: snap.status } : j));
          } else if (snap.status === "awaiting_input" && snap.questions?.length) {
            // Never downgrade an optimistic 'running' (answers just sent) —
            // a stale poll response must not resurrect answered cards.
            setJob((j) =>
              j && j.status !== "running"
                ? { ...j, status: "awaiting_input", questions: snap.questions ?? [] }
                : j,
            );
          } else if (snap.status === "queued" || snap.status === "running") {
            // Reconcile forward (e.g. after answers resumed the job) so the
            // awaiting predicate collapses even if the SSE stream is dead.
            setJob((j) =>
              j && j.status !== snap.status
                ? { ...j, status: snap.status, questions: [] }
                : j,
            );
          } else if (snap.status === "succeeded" && !finalizedRef.current) {
            finalizedRef.current = true;
            setJob((j) => (j ? { ...j, status: "succeeded" } : j));
            setReadyToReveal(true);
            if (!inputRef.current.trim()) {
              window.setTimeout(() => window.location.reload(), 900);
            }
          }
        })
        .catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [jobIsActive, jobUrls]);

  const submitAnswers = useCallback(
    (answers: Record<string, string>) => {
      if (!jobUrls) return;
      setBusy(true);
      postJson(jobUrls.answers, { answers })
        .then(() => setJob((j) => (j ? { ...j, status: "running", questions: [] } : j)))
        .catch(() => undefined)
        .finally(() => setBusy(false));
    },
    [jobUrls],
  );

  const stopJob = useCallback(() => {
    if (!jobUrls) return;
    setBusy(true);
    postJson(jobUrls.cancel)
      .then(() => {
        setCancelled(true);
        setJob((j) => (j ? { ...j, status: "cancelled" } : j));
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, [jobUrls]);

  const sendEdit = useCallback(() => {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    postJson<{ job_ref_id: string }>(props.urls.chat, { instruction: message })
      .then((payload) => {
        setInput("");
        setCancelled(false);
        setReadyToReveal(false);
        // finalizedRef re-arms when the new stream resets to 'connecting' —
        // NOT here, or the terminal effect fires on the old stream's phase.
        const base = `${props.urls.jobBase}${payload.job_ref_id}`;
        setJob({
          refId: payload.job_ref_id,
          status: "queued",
          prompt: message,
          error: null,
          questions: [],
        });
        setJobUrls({
          stream: `${base}/stream`,
          status: `${base}/status`,
          answers: `${base}/answers`,
          cancel: `${base}/cancel`,
        });
      })
      .catch(() => undefined)
      .finally(() => setSending(false));
  }, [input, props.urls.chat, props.urls.jobBase, sending]);

  const previewOrCurrent = previewVersion?.play_url
    ? withLang(previewVersion.play_url, props.locale)
    : props.player?.src ?? null;

  const codeVersionId =
    previewVersion?.id ?? currentVersionId ?? versions[versions.length - 1]?.id ?? null;

  const onPlayerMessage = useCallback((message: GameMessage) => {
    consoleSeq.current += 1;
    const level =
      message.event === "game_error" ? "error" : message.event === "game_over" ? "warn" : "info";
    const detail = message.data ? ` ${JSON.stringify(message.data)}` : "";
    setConsoleEntries((entries) => [
      ...entries.slice(-199),
      { id: consoleSeq.current, level, message: `${message.event}${detail}`, ts: Date.now() },
    ]);
  }, []);

  const wasCancelled =
    cancelled || job?.status === "cancelled" || job?.status === "expired";
  const failed = !wasCancelled && (stream.phase === "failed" || job?.status === "failed");
  const failureMessage = stream.errorMessage || job?.error || t.ws_failed;
  const showTimeline = jobIsActive || stream.steps.length > 0;

  return (
    <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
      {/* Chat pane */}
      <section className="flex min-h-0 flex-col gap-3">
        <div className="fp-card flex-1 space-y-4 overflow-y-auto p-4">
          <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-[var(--color-violet)]/15 px-4 py-2.5 text-sm text-[var(--color-ink)]">
            {job?.prompt || props.game.prompt}
          </div>

          {wasCancelled ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              {job?.status === "expired" ? t.ws_expired : t.ws_cancelled}
            </p>
          ) : failed ? (
            <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-ink)]">
              <p>{failureMessage}</p>
              <a className="fp-btn fp-btn-soft fp-btn-sm mt-2" href={`/create?idea=${encodeURIComponent(job?.prompt || props.game.prompt)}`}>
                {t.ws_try_again}
              </a>
            </div>
          ) : showTimeline ? (
            <StepTimeline
              steps={stream.steps}
              activities={stream.activities}
              heals={stream.heals}
              messages={stream.messages}
              thinking={jobIsActive && !awaiting && stream.phase !== "done"}
              thinkingLabel={t.ws_working}
            />
          ) : null}

          {awaiting && (
            <ClarifyCards
              questions={questions}
              submitting={busy}
              labels={{
                title: t.clarify_title,
                continue: t.clarify_continue,
                surprise: t.clarify_surprise,
              }}
              onSubmit={submitAnswers}
              onSurpriseMe={() => submitAnswers({})}
            />
          )}

          {(stream.phase === "done" || job?.status === "succeeded") && (
            <div className="space-y-2">
              <p className="text-sm text-[var(--color-success)]">
                {t.ws_done} {stream.doneTitle ? `— ${stream.doneTitle}` : ""}
              </p>
              {readyToReveal && (
                <button
                  type="button"
                  className="fp-btn fp-btn-cta fp-btn-sm"
                  onClick={() => window.location.reload()}
                >
                  {t.ws_play_it}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="fp-card p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!jobIsActive) sendEdit();
                }
              }}
              rows={2}
              disabled={jobIsActive || !props.game.isLive}
              placeholder={
                jobIsActive
                  ? awaiting
                    ? t.composer_awaiting
                    : t.composer_running
                  : props.game.isLive
                    ? t.composer_edit
                    : t.composer_waiting_first
              }
              className="fp-input min-h-[44px] flex-1 resize-none"
            />
            {jobIsActive ? (
              <button
                type="button"
                onClick={stopJob}
                disabled={busy}
                className="fp-btn fp-btn-danger fp-btn-sm fp-hit"
              >
                {t.ws_stop}
              </button>
            ) : (
              <button
                type="button"
                onClick={sendEdit}
                disabled={!input.trim() || sending || !props.game.isLive}
                className="fp-btn fp-btn-cta fp-btn-sm fp-hit"
                aria-label={t.composer_send}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="fp-flip-rtl" aria-hidden>
                  <path d="m5 12 14 0M13 6l6 6-6 6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Game / Code / Versions pane */}
      <section className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center gap-1 rounded-full border border-[var(--color-edge-subtle)] bg-[var(--color-surface-1)] p-1 self-start">
          {(["game", "code", "versions"] as RightTab[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`fp-hit rounded-full px-4 py-1.5 text-sm ${
                tab === key
                  ? "bg-[var(--color-surface-3)] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink-secondary)]"
              }`}
            >
              {key === "game" ? t.tab_game : key === "code" ? t.tab_code : t.tab_versions}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1">
          {tab === "game" &&
            (previewOrCurrent ? (
              <div className="space-y-2">
                <GamePlayer
                  src={previewOrCurrent}
                  gameOrigin={previewVersion ? originOf(previewVersion.play_url) : props.player?.origin || ""}
                  title={props.game.title}
                  labels={{
                    loading: t.player_loading,
                    stuck: t.player_stuck,
                    reload: t.player_reload,
                    fullscreen: t.player_fullscreen,
                  }}
                  onMessage={onPlayerMessage}
                />
                <button
                  type="button"
                  onClick={() => setConsoleOpen((open) => !open)}
                  className="fp-btn fp-btn-ghost fp-btn-sm"
                >
                  {consoleOpen ? t.console_hide : t.console_show}
                </button>
                {consoleOpen && (
                  <div className="h-40">
                    <ConsolePane entries={consoleEntries} emptyLabel={t.console_empty} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-dashed border-[var(--color-edge)] text-sm text-[var(--color-ink-muted)]">
                <span className={jobIsActive ? "fp-shimmer" : ""}>
                  {jobIsActive ? t.ws_player_pending : t.ws_player_empty}
                </span>
              </div>
            ))}

          {tab === "code" && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-[var(--color-ink-muted)]">
                  <span className="fp-shimmer">{t.code_loading}</span>
                </div>
              }
            >
              <CodeView
                sourceUrl={
                  codeVersionId ? `${props.urls.versions}/${codeVersionId}/source` : null
                }
                labels={{
                  loading: t.code_loading,
                  empty: t.code_empty,
                  copy: t.code_copy,
                  copied: t.code_copied,
                }}
              />
            </Suspense>
          )}

          {tab === "versions" &&
            (versions.length ? (
              <VersionTree
                versions={versions}
                currentVersionId={currentVersionId}
                previewVersionId={previewVersion?.id ?? null}
                busy={busy}
                labels={{
                  current: t.version_current,
                  preview: t.version_preview,
                  restore: t.version_restore,
                  initial: t.version_initial,
                }}
                onPreview={(version) => {
                  setPreviewVersion(version);
                  setTab("game");
                }}
                onRollback={(version) => {
                  setBusy(true);
                  postJson<{ play_url: string }>(props.urls.rollback, {
                    version_id: version.id,
                  })
                    .then(() => {
                      // Show the restored version immediately; the server
                      // pointer already flipped, so 'preview' == current.
                      setPreviewVersion(version);
                      refreshVersions();
                      setTab("game");
                    })
                    .catch(() => undefined)
                    .finally(() => setBusy(false));
                }}
              />
            ) : (
              <div className="text-sm text-[var(--color-ink-muted)]">{t.versions_empty}</div>
            ))}
        </div>
      </section>
    </div>
  );
}

function withLang(url: string, locale: string): string {
  if (!url) return url;
  return `${url}${url.includes("?") ? "&" : "?"}lang=${locale}`;
}

function originOf(url: string): string {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return "";
  }
}
