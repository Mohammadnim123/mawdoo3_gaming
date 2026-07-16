"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
} from "react";
import {
  ArrowUp,
  Camera,
  ImagePlus,
  Loader2,
  MessageCircleQuestion,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { cn } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { ComposerMode } from "@/domain/workspace/composer";
import {
  ACCEPTED_IMAGE_ACCEPT,
  readFileAsDataUrl,
  screenshotAttachment,
  validateImageFile,
  type AttachmentError,
  type ComposerAttachment,
} from "@/domain/workspace/attachment";

export interface ComposerProps {
  mode: ComposerMode;
  value: string;
  onChange: (value: string) => void;
  /** E40: `imageBase64` is the attached image's data URL (upload or screenshot). */
  onSend: (message: string, imageBase64?: string) => void;
  onStop: () => void;
  /** Send in flight (POST /generate | /chat). */
  sending?: boolean;
  /** Cancel in flight (POST /jobs/{id}/cancel). */
  stopping?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** E40: enable the image-attach button (an existing project only — the first
   *  prompt has no game to change / screenshot). */
  attachEnabled?: boolean;
  /** E40: screenshot the running game; resolves its data URL or null. Present
   *  only while a game is mounted and ready — omit to hide the screenshot item. */
  onCaptureScreenshot?: () => Promise<string | null>;
  className?: string;
}

/**
 * The one workspace input (E14-F7): idle → send, running → STOP,
 * awaiting_input → disabled with helper text (the clarify cards are the
 * input). Enter submits, Shift+Enter newline; on touch the button is the
 * only submit path. E40: a paperclip opens an attach menu (upload an image or
 * screenshot the running game); the picked image previews above the field and
 * rides along with the next message.
 */
export function Composer({
  mode,
  value,
  onChange,
  onSend,
  onStop,
  sending = false,
  stopping = false,
  placeholder,
  inputRef,
  attachEnabled = false,
  onCaptureScreenshot,
  className,
}: ComposerProps): ReactElement {
  const { t } = useI18n();
  const attachT = t.workspace.composerInput.attach;
  const effectivePlaceholder = placeholder ?? t.workspace.composerInput.defaultPlaceholder;
  // Coarse pointers submit via the button only (E14-F7); computed once.
  const [coarsePointer] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );

  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const awaiting = mode === "awaiting";
  // Stop is available whenever a job is cancellable: streaming OR paused on
  // clarifying questions (POST /jobs/{id}/cancel finalizes awaiting_input).
  const running = mode === "running" || mode === "awaiting";
  const canSend =
    mode === "idle" && !sending && (value.trim() !== "" || attachment !== null);
  // The attach affordance is only meaningful while composing a fresh message.
  const showAttach = attachEnabled && mode === "idle";

  const localizeError = (error: AttachmentError): string =>
    error === "too-large"
      ? attachT.tooLarge
      : error === "wrong-type"
        ? attachT.wrongType
        : attachT.readFailed;

  const send = (): void => {
    const trimmed = value.trim();
    if ((trimmed === "" && attachment === null) || mode !== "idle" || sending) return;
    onSend(trimmed, attachment?.dataUrl);
    setAttachment(null);
    setAttachError(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || coarsePointer) return;
    event.preventDefault();
    send();
  };

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ""; // re-selecting the same file must fire again
    setMenuOpen(false);
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setAttachError(localizeError(invalid));
      return;
    }
    readFileAsDataUrl(file)
      .then((dataUrl) => {
        setAttachment({ dataUrl, source: "upload" });
        setAttachError(null);
      })
      .catch((error: AttachmentError) => setAttachError(localizeError(error)));
  };

  const doScreenshot = (): void => {
    if (!onCaptureScreenshot || capturing) return;
    setMenuOpen(false);
    setCapturing(true);
    onCaptureScreenshot()
      .then((dataUrl) => {
        if (dataUrl) {
          setAttachment(screenshotAttachment(dataUrl));
          setAttachError(null);
        } else {
          setAttachError(attachT.captureFailed);
        }
      })
      .catch(() => setAttachError(attachT.captureFailed))
      .finally(() => setCapturing(false));
  };

  // Dismiss the attach menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // A picked attachment is stale once the field is disabled (a new job started
  // from elsewhere / clarify pause) — drop it so it can't send into the wrong turn.
  useEffect(() => {
    if (!showAttach && attachment !== null) setAttachment(null);
  }, [showAttach, attachment]);

  return (
    <div
      className={cn("flex flex-col gap-1.5 border-t border-edge-subtle p-3", "fp-safe-b", className)}
      data-testid="workspace-composer"
      data-mode={mode}
    >
      {attachment && (
        <AttachmentPreview
          attachment={attachment}
          sourceLabel={
            attachment.source === "screenshot" ? attachT.screenshotLabel : attachT.uploadedLabel
          }
          previewLabel={attachT.preview}
          removeLabel={attachT.remove}
          onRemove={() => setAttachment(null)}
        />
      )}
      {attachError && (
        <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <X className="size-3.5 shrink-0" aria-hidden />
          {attachError}
        </p>
      )}
      <div className="flex items-end gap-2">
        {showAttach && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              disabled={capturing}
              aria-label={attachT.button}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={cn(
                "fp-hit inline-flex size-11 items-center justify-center rounded-full",
                "border border-edge bg-surface-2 text-ink-secondary transition-colors duration-150 ease-out",
                "hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              data-testid="composer-attach"
            >
              {capturing ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Paperclip className="size-5" aria-hidden />
              )}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className={cn(
                  "absolute bottom-full mb-2 start-0 z-30 w-56 overflow-hidden rounded-2xl",
                  "border border-edge bg-surface-1 p-1",
                )}
                data-testid="composer-attach-menu"
              >
                <AttachMenuItem
                  icon={<ImagePlus className="size-4 shrink-0" aria-hidden />}
                  label={attachT.uploadImage}
                  onClick={() => fileInputRef.current?.click()}
                />
                {onCaptureScreenshot && (
                  <AttachMenuItem
                    icon={<Camera className="size-4 shrink-0" aria-hidden />}
                    label={attachT.screenshotGame}
                    onClick={doScreenshot}
                    testId="composer-attach-screenshot"
                  />
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_ACCEPT}
              className="hidden"
              data-testid="composer-file-input"
              onChange={onFilePicked}
            />
          </div>
        )}
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={effectivePlaceholder}
          disabled={awaiting}
          rows={1}
          aria-label={t.workspace.composerInput.message}
          className={cn(
            "max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-edge bg-surface-2 px-3 py-2.5",
            // 16px body text — iOS focus-zoom guard; placeholder ellipsizes.
            "text-base text-ink placeholder:text-ink-muted [&::placeholder]:truncate",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
            "disabled:opacity-50",
          )}
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            aria-label={t.workspace.composerInput.stopGenerating}
            className={cn(
              "fp-hit inline-flex size-11 shrink-0 items-center justify-center rounded-full",
              "border border-danger/40 bg-danger/10 text-danger transition-colors duration-150 ease-out",
              "hover:bg-danger/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            data-testid="composer-stop"
          >
            <Square className={cn("size-4 fill-current", stopping && "fp-pulse")} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label={t.workspace.composerInput.sendMessage}
            className={cn(
              "fp-hit inline-flex size-11 shrink-0 items-center justify-center rounded-full",
              "border-0 bg-[image:var(--gradient-cta)] text-ink-on-accent transition-opacity duration-150 ease-out",
              "hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
            data-testid="composer-send"
          >
            <ArrowUp className={cn("size-5", sending && "fp-pulse")} aria-hidden />
          </button>
        )}
      </div>
      {awaiting && (
        <p className="flex items-center gap-1.5 text-xs text-warning" role="status">
          <MessageCircleQuestion className="size-3.5 shrink-0" aria-hidden />
          {t.workspace.composerInput.answerAbove}
        </p>
      )}
    </div>
  );
}

function AttachMenuItem({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: ReactElement;
  label: string;
  onClick: () => void;
  testId?: string;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-medium",
        "text-ink transition-colors duration-150 ease-out hover:bg-surface-2",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function AttachmentPreview({
  attachment,
  sourceLabel,
  previewLabel,
  removeLabel,
  onRemove,
}: {
  attachment: ComposerAttachment;
  sourceLabel: string;
  previewLabel: string;
  removeLabel: string;
  onRemove: () => void;
}): ReactElement {
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl border border-edge bg-surface-2 p-2"
      data-testid="composer-attachment"
    >
      {/* Data-URL thumbnail — plain <img>, no next/image remote config needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
      <img
        src={attachment.dataUrl}
        alt={previewLabel}
        className="size-12 shrink-0 rounded-lg border border-edge-subtle object-cover"
      />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-secondary">
        {sourceLabel}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className={cn(
          "fp-hit inline-flex size-8 shrink-0 items-center justify-center rounded-full",
          "text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-3 hover:text-ink",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
        )}
        data-testid="composer-attachment-remove"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
