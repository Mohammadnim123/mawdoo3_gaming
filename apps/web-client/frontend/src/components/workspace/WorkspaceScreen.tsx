"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { ApiError } from "@codply/contracts";
import { Button, EmptyState, Skeleton, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { stepLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useInvalidateMe, useMe } from "@/domain/hooks/useMe";
import { useInvalidateCredits, useSubscription } from "@/domain/hooks/useCredits";
import { CreditsExhaustedDialog } from "@/components/account/CreditsExhaustedDialog";
import { PricingDialog } from "@/components/account/PricingDialog";
import { useJobStream } from "@/domain/jobStream/useJobStream";
import { isTerminalStatus } from "@/domain/jobStream/reducer";
import { buildThread, latestJobId, pastJobIds, pendingAcknowledged } from "@/domain/workspace/thread";
import { usePastJobTranscripts } from "@/domain/workspace/usePastJobTranscripts";
import { deriveComposerMode } from "@/domain/workspace/composer";
import { captureGameScreenshot } from "@/domain/workspace/captureScreenshot";
import { fixItMessage } from "@/domain/workspace/fixIt";
import { recallJobPrompt, rememberJobPrompt } from "@/domain/workspace/promptHandoff";
import { useWorkspaceStore } from "@/stores/workspace";
import { WorkspaceShell } from "./WorkspaceShell";
import { ChatThread } from "./ChatThread";
import { GenerationCard } from "./GenerationCard";
import { PastJobCard } from "./PastJobCard";
import { Composer } from "./Composer";
import { GameView } from "./GameView";
import { LibraryView } from "./LibraryView";
import { CodeView } from "./CodeView";
import { DraftCodeView } from "./DraftCodeView";
import { HistorySheet } from "./HistorySheet";
import { PostDialog } from "./PostDialog";
import { workspaceChatKey, workspaceGameKey, workspaceVersionsKey } from "./queryKeys";

export interface WorkspaceScreenProps {
  /** `/studio/{gameId}` route param (null on `/studio`). */
  gameIdParam: string | null;
  /** `/studio?job={id}` handoff from `/create` (E14-F1). */
  initialJobId: string | null;
}

/**
 * The unified create-play-edit surface (E14): owns ALL workspace data flow —
 * owner guard, chat hydration, the one job stream, send/stop/answers/retry —
 * and hands pure state to the shell + views (screens hold no business rules;
 * those live in `domain/workspace/*`).
 */
export function WorkspaceScreen({ gameIdParam, initialJobId }: WorkspaceScreenProps): ReactElement {
  const { t, f } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidateMe = useInvalidateMe();
  const invalidateCredits = useInvalidateCredits();
  const { data: me, isPending: mePending } = useMe();
  // E29-F2: plan key gates the failed card's upgrade action (free-only).
  const subscription = useSubscription(Boolean(me));
  const planKey = subscription.data?.plan.key ?? null;

  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [doneGameId, setDoneGameId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    content: string;
    at: string;
    imageUrl?: string | null;
  } | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cancelledJobId, setCancelledJobId] = useState<string | null>(null);
  const [submittingAnswers, setSubmittingAnswers] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  // E29: a 402 send opens the out-of-credits dialog (→ pricing on demand).
  const [creditsBlocked, setCreditsBlocked] = useState<{ balance: number | null } | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  // ADR-0008: build mode for a NEW project (dev-gated A/B — agent vs engine).
  const [generationMode, setGenerationMode] = useState<"agent" | "engine">("agent");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const setView = useWorkspaceStore((s) => s.setView);
  const setPane = useWorkspaceStore((s) => s.setPane);
  const resetWorkspace = useWorkspaceStore((s) => s.reset);
  // E40: live in-frame screenshot fn published by the mounted player (null when
  // not ready) — the composer prefers it (exact view), server render is fallback.
  const captureGame = useWorkspaceStore((s) => s.captureGame);
  const developerMode = useWorkspaceStore((s) => s.developerMode);

  // Per-project UI reset (view, console, mounted player).
  useEffect(() => {
    resetWorkspace();
    return () => resetWorkspace();
  }, [gameIdParam, resetWorkspace]);

  // ── Owner guard + game detail (E14-F1) ────────────────────────────────────
  const gameKey = gameIdParam ?? doneGameId;
  const meHandle = me?.handle ?? null;
  const resolution = useQuery({
    queryKey: workspaceGameKey(gameKey ?? ""),
    queryFn: () => getServices().games.resolveWorkspaceGame(gameKey as string, meHandle),
    enabled: gameKey !== null && !mePending,
  });
  const game = resolution.data?.kind === "owner" ? resolution.data.game : null;

  useEffect(() => {
    if (resolution.data?.kind === "redirect") {
      router.replace(resolution.data.to as Route);
    }
  }, [resolution.data, router]);

  // ── Thread hydration (E14-F2) ─────────────────────────────────────────────
  const chatQuery = useQuery({
    queryKey: workspaceChatKey(game?.id ?? ""),
    queryFn: () => getServices().games.chatHistory(game?.id ?? "", { limit: 50 }),
    enabled: game !== null,
  });
  const history = useMemo(() => chatQuery.data?.items ?? [], [chatQuery.data]);

  useEffect(() => {
    if (jobId !== null || !chatQuery.isSuccess) return;
    const latest = latestJobId(history);
    if (latest !== null) setJobId(latest);
  }, [chatQuery.isSuccess, history, jobId]);

  // The optimistic echo retires the moment the server-persisted user row for
  // THIS send's job lands in history — from then on the history bubble (with
  // the card spliced after it) is the prompt; keeping both rendered the
  // message twice for the whole build. `sending` guards the in-flight window
  // where jobId still names the PREVIOUS job.
  useEffect(() => {
    if (!sending && pendingAcknowledged(history, jobId, pending)) setPending(null);
  }, [sending, history, jobId, pending]);

  // ── The one job stream (E14-F3) ───────────────────────────────────────────
  const stream = useJobStream(jobId);
  const jobRunning =
    jobId !== null && !isTerminalStatus(stream.status) && cancelledJobId !== jobId;

  const doneEvent = stream.done;
  useEffect(() => {
    if (jobId === null || doneEvent === null) return;
    setPending(null);
    const publishedGameId = doneEvent.game_id;
    if (gameIdParam === null && doneGameId === null && publishedGameId !== "") {
      // URL-replace (no remount) — the live card and player stay put.
      setDoneGameId(publishedGameId);
      window.history.replaceState(null, "", `/studio/${publishedGameId}`);
    }
    void invalidateMe();
    // E29: the worker settles the credit spend on done — refresh the ledger.
    void invalidateCredits();
    void queryClient.invalidateQueries({ queryKey: workspaceGameKey(gameIdParam ?? publishedGameId) });
    void queryClient.invalidateQueries({ queryKey: workspaceChatKey(publishedGameId) });
    void queryClient.invalidateQueries({ queryKey: workspaceVersionsKey(publishedGameId) });
    void queryClient.invalidateQueries({ queryKey: ["workspace-files", publishedGameId] });
    void queryClient.invalidateQueries({ queryKey: ["me-assets"] });
  }, [doneEvent, jobId, gameIdParam, doneGameId, invalidateMe, invalidateCredits, queryClient]);

  const failedEvent = stream.failed;
  useEffect(() => {
    if (jobId === null || failedEvent === null) return;
    setPending(null);
    if (game !== null) {
      void queryClient.invalidateQueries({ queryKey: workspaceChatKey(game.id) });
    }
  }, [failedEvent, jobId, game, queryClient]);

  // ── Composer actions (E14-F7) ─────────────────────────────────────────────
  const send = useCallback(
    async (text: string, imageBase64?: string): Promise<void> => {
      if (sending) return;
      setSending(true);
      // E40: echo the attached image in the optimistic bubble too (data URL) —
      // the server-persisted CDN url takes over once the user row lands.
      setPending({ content: text, at: new Date().toISOString(), imageUrl: imageBase64 ?? null });
      setInput("");
      try {
        if (game !== null) {
          const { job_id } = await getServices().games.sendChat(game.id, text, imageBase64);
          rememberJobPrompt(job_id, text);
          setJobId(job_id);
        } else {
          // ADR-0008: pin the build mode only when the dev-gated toggle is
          // shown; otherwise omit it so the server default applies.
          const { job_id, game_id } = await getServices().jobs.generate(
            text,
            developerMode ? { generationMode } : undefined,
          );
          rememberJobPrompt(job_id, text);
          await invalidateMe(); // quota consumed
          setJobId(job_id);
          // Adopt the project NOW (v0.4: it exists from accept) — otherwise a
          // failed run in this session would generate a NEW game on the next
          // message instead of recovering this one (game stays null until
          // gameKey resolves; the URL replaceState below never remounts).
          if (game_id) setDoneGameId(game_id);
          // v0.4: the draft project exists from accept — put its id in the URL
          // so a reload lands on the server-seeded thread (recovery-ready).
          const base = game_id ? `/studio/${encodeURIComponent(game_id)}` : "/studio";
          window.history.replaceState(null, "", `${base}?job=${encodeURIComponent(job_id)}`);
        }
        setCancelledJobId(null);
      } catch (error) {
        setPending(null);
        setInput(text);
        if (ApiError.isApiError(error) && error.code === "quota_exceeded") {
          toast({
            title: t.workspace.send.quotaReached,
            description: t.workspace.send.quotaReachedDescription,
            variant: "info",
          });
        } else if (ApiError.isApiError(error) && error.code === "credits_exhausted") {
          // E29 admission gate (402): the envelope carries the balance —
          // open the upsell dialog instead of a dead-end toast.
          const balance = error.details["balance"];
          setCreditsBlocked({ balance: typeof balance === "number" ? balance : null });
        } else if (ApiError.isApiError(error) && error.code === "moderation_blocked") {
          toast({ title: t.workspace.send.promptBlocked, description: error.message, variant: "error" });
        } else if (ApiError.isApiError(error) && error.code === "conflict") {
          toast({
            title: t.workspace.send.stillFinishing,
            description: t.workspace.send.stillFinishingDescription,
            variant: "info",
          });
        } else {
          toast({
            title: t.workspace.send.sendFailed,
            description: ApiError.isApiError(error) ? error.message : t.common.tryAgainLater,
            variant: "error",
          });
        }
      } finally {
        setSending(false);
      }
    },
    [game, invalidateMe, sending, toast, t, developerMode, generationMode],
  );

  const stop = useCallback(async (): Promise<void> => {
    if (jobId === null || stopping) return;
    setStopping(true);
    try {
      await getServices().jobs.cancel(jobId);
      // Queued/awaiting cancels finalize WITHOUT an SSE event — mark locally.
      setCancelledJobId(jobId);
      void invalidateMe(); // possible refund
      toast({ title: t.workspace.send.stopped, variant: "info" });
    } catch (error) {
      if (ApiError.isApiError(error) && error.code === "conflict") {
        // Already finished — the stream's terminal event wins.
      } else {
        toast({ title: t.workspace.send.stopFailed, variant: "error" });
      }
    } finally {
      setStopping(false);
    }
  }, [invalidateMe, jobId, stopping, toast, t]);

  const submitAnswers = useCallback(
    async (answers: Record<string, string>): Promise<void> => {
      if (jobId === null || submittingAnswers) return;
      setSubmittingAnswers(true);
      try {
        await getServices().jobs.answers(jobId, answers);
      } catch (error) {
        // 409 = already answered (double submit / second tab) — carry on.
        if (!(ApiError.isApiError(error) && error.code === "conflict")) {
          toast({ title: t.workspace.send.answersFailed, variant: "error" });
        }
      } finally {
        setSubmittingAnswers(false);
      }
    },
    [jobId, submittingAnswers, toast, t],
  );

  const retry = useCallback((): void => {
    const fromHistory = [...history]
      .reverse()
      .find((m) => m.role === "user" && m.job_id === jobId)?.content;
    const text = pending?.content ?? (jobId !== null ? recallJobPrompt(jobId) : null) ?? fromHistory;
    if (text !== undefined && text !== null && text !== "") {
      void send(text);
    } else {
      setPane("chat");
      composerRef.current?.focus();
    }
  }, [history, jobId, pending, send, setPane]);

  // ── Derived view state ────────────────────────────────────────────────────
  const handoffPrompt = useMemo(() => (jobId !== null ? recallJobPrompt(jobId) : null), [jobId]);
  // E28: past jobs replay their persisted transcript from the job snapshot —
  // one lazy fetch per finished job visible in the thread (cached forever).
  const pastIds = useMemo(() => pastJobIds(history, jobId), [history, jobId]);
  const pastTranscripts = usePastJobTranscripts(pastIds);
  const transcriptJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, state] of pastTranscripts) {
      if (state.timeline.some((t) => t.type === "text")) ids.add(id);
    }
    return ids;
  }, [pastTranscripts]);
  const days = useMemo(
    () =>
      buildThread({
        history,
        pending,
        handoffPrompt,
        activeJobId: jobId,
        // A card owns its job's narration while its timeline holds any (E18);
        // terminal snapshots seed the transcript (E28), so reloads keep the
        // card in charge — the thread renders bubbles only when a job has no
        // transcript to show.
        activeJobTranscript: stream.timeline.some((item) => item.type === "text"),
        transcriptJobIds,
        dayLabels: {
          today: t.time.today,
          yesterday: t.time.yesterday,
          formatDate: f.dayLabel,
        },
      }),
    [history, pending, handoffPrompt, jobId, stream.timeline, transcriptJobIds, t, f],
  );

  const composerMode = deriveComposerMode({
    jobId: cancelledJobId === jobId ? null : jobId,
    status: stream.status,
  });
  const runningStep = stream.steps.find((s) => s.status === "running");
  const currentStepLabel = jobRunning
    ? `${runningStep?.label ?? stepLabel(t, stream.status)}…`
    : null;
  const currentPlayUrl = stream.done?.play_url ?? game?.current_version?.play_url ?? null;
  const workspaceGameId = game?.id ?? stream.done?.game_id ?? gameKey;
  const showGame = useCallback((): void => setView("game"), [setView]);
  const backToChat = useCallback((): void => {
    setPane("chat");
    composerRef.current?.focus();
  }, [setPane]);
  const askAiToFix = useCallback(
    (text: string): void => {
      setInput(text);
      setPane("chat");
      composerRef.current?.focus();
    },
    [setPane],
  );

  // ── Guard screens (no owner UI leaks; E14-F1) ─────────────────────────────
  if (gameKey !== null && (resolution.isPending || mePending)) {
    return <WorkspaceSkeleton />;
  }
  if (gameKey !== null && resolution.data?.kind === "redirect") {
    return <WorkspaceSkeleton />; // redirecting — never flash owner UI
  }
  if (gameKey !== null && (resolution.isError || resolution.data?.kind === "not-found")) {
    return (
      <div className="mx-auto flex h-full max-w-md items-center px-4">
        <EmptyState
          icon={Lock}
          title={t.workspace.guard.title}
          description={t.workspace.guard.description}
          action={
            <Link href="/feed">
              <Button variant="soft">{t.workspace.guard.backToFeed}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      <WorkspaceShell
        currentProject={game !== null ? { id: game.id, title: game.title } : null}
        canPost={game !== null}
        historyDisabled={game === null}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenPost={() => setPostOpen(true)}
        chat={
          <>
            <ChatThread
              days={days}
              loading={game !== null && chatQuery.isPending}
              renderPastJob={(item) => (
                <PastJobCard item={item} state={pastTranscripts.get(item.jobId) ?? null} />
              )}
              renderJobCard={() => (
                <GenerationCard
                  stream={stream}
                  cancelled={cancelledJobId !== null && cancelledJobId === jobId}
                  onSubmitAnswers={(answers) => void submitAnswers(answers)}
                  submittingAnswers={submittingAnswers}
                  onRetry={retry}
                  onFixIt={
                    game !== null
                      ? // E22/S11: tell the recovery agent what auto-repair
                        // already tried so it doesn't repeat failed patches.
                        () => void send(fixItMessage(stream.healNotes))
                      : undefined
                  }
                  onPlay={showGame}
                  planKey={planKey}
                  // E29-F2: exhaustion failures on the free plan surface the
                  // upgrade CTA — same PricingDialog instance as the
                  // credits-exhausted flow below.
                  onUpgrade={() => setPricingOpen(true)}
                />
              )}
            />
            {game === null && developerMode && (
              // ADR-0008: dev-gated A/B switch — pick how a NEW game is built.
              // End users never see it; the server default applies for them.
              <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 px-1">
                <span className="text-xs text-ink-muted">{t.workspace.buildMode.label}</span>
                <div
                  role="group"
                  aria-label={t.workspace.buildMode.label}
                  className="flex overflow-hidden rounded-full border border-edge-subtle"
                >
                  {(["agent", "engine"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setGenerationMode(m)}
                      aria-pressed={generationMode === m}
                      className={`px-3 py-1 text-xs font-medium transition-colors ${
                        generationMode === m
                          ? "bg-surface-3 text-ink"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {t.workspace.buildMode[m]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Composer
              mode={composerMode}
              value={input}
              onChange={setInput}
              onSend={(text, image) => void send(text, image)}
              onStop={() => void stop()}
              sending={sending}
              stopping={stopping}
              // E40: attach an image only on an existing project (the first
              // prompt has no game to change / screenshot). Screenshot prefers
              // the LIVE in-frame capture (exactly what's on screen) and falls
              // back to a server render for games whose shim can't self-capture.
              attachEnabled={game !== null}
              onCaptureScreenshot={
                game !== null
                  ? () =>
                      captureGameScreenshot({
                        live: captureGame,
                        server: () => getServices().games.screenshotGame(game.id),
                      })
                  : undefined
              }
              placeholder={
                game !== null && stream.failed !== null
                  ? t.workspace.composerInput.fixPlaceholder
                  : game !== null
                    ? t.workspace.composerInput.changePlaceholder
                    : t.workspace.composerInput.newPlaceholder
              }
              inputRef={composerRef}
            />
          </>
        }
        gameView={
          <GameView
            gameId={workspaceGameId}
            title={game?.title ?? stream.done?.title ?? null}
            currentPlayUrl={currentPlayUrl}
            jobRunning={jobRunning}
            bootJobId={jobRunning ? jobId : null}
            currentStepLabel={currentStepLabel}
          />
        }
        libraryView={<LibraryView gameId={game?.id ?? null} onBackToChat={backToChat} />}
        codeView={
          jobId !== null && (jobRunning || game === null || game.current_version === null) ? (
            <DraftCodeView jobId={jobId} running={jobRunning} onBackToChat={backToChat} />
          ) : game !== null && game.current_version !== null ? (
            <CodeView
              game={game}
              version={game.current_version}
              gameKey={gameKey ?? game.id}
              onAskAiToFix={askAiToFix}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4">
              <EmptyState
                icon={Lock}
                title={t.workspace.codeView.noCodeTitle}
                description={t.workspace.codeView.noCodeDescription}
                className="w-full max-w-md border-0 bg-transparent"
              />
            </div>
          )
        }
      />
      {game !== null && (
        <>
          <HistorySheet
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            game={game}
            gameKey={gameKey ?? game.id}
            onShowGame={showGame}
          />
          <PostDialog
            open={postOpen}
            onClose={() => setPostOpen(false)}
            game={game}
            gameKey={gameKey ?? game.id}
          />
        </>
      )}
      <CreditsExhaustedDialog
        open={creditsBlocked !== null}
        balance={creditsBlocked?.balance ?? null}
        onClose={() => setCreditsBlocked(null)}
        onGetMore={() => {
          setCreditsBlocked(null);
          setPricingOpen(true);
        }}
      />
      <PricingDialog open={pricingOpen} onClose={() => setPricingOpen(false)} />
    </>
  );
}

function WorkspaceSkeleton(): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-edge-subtle px-3">
        <Skeleton className="size-9 rounded-2xl" />
        <Skeleton className="h-8 w-40" />
        <span className="flex-1" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="size-8 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[420px] shrink-0 flex-col gap-3 border-e border-edge-subtle p-4 lg:flex">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <span className="flex-1" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
