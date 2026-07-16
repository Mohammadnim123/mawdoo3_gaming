"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Check, Link2, MessageCircle, Twitter } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../primitives/Button";

export interface ShareBarProps {
  /** Absolute URL of the game page. */
  url: string;
  /** Share text; defaults to the title or a generic line. */
  title?: string;
  onCopied?: () => void;
  /** User-visible strings — lifted to props so apps can localize (E33). */
  labels?: {
    copyLink?: string;
    copied?: string;
    postOnX?: string;
    whatsApp?: string;
    /** Default share text when no `title` is given. */
    defaultText?: string;
  };
  className?: string;
}

/** Copy-link + X + WhatsApp share intents (no SDKs, plain intents). */
export function ShareBar({ url, title, onCopied, labels, className }: ShareBarProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = title ?? labels?.defaultText ?? "I made this game with a prompt on Codply";

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — leave state as-is.
    }
  }, [onCopied, url]);

  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const whatsAppHref = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;

  const anchorClass = cn(
    "fp-hit inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-edge bg-surface-2 px-4 text-sm",
    "text-ink-secondary transition-colors duration-200 ease-out hover:bg-surface-3 hover:text-ink",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
  );

  return (
    // Wraps on narrow screens; actions stretch to share the row instead of
    // overflowing (`flex-none` restores hug-content sizing from sm up).
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none", className)}
      data-testid="share-bar"
    >
      <Button
        variant="soft"
        className="whitespace-nowrap"
        onClick={() => void copy()}
        leftIcon={
          copied ? (
            <Check className="size-4 text-success" aria-hidden />
          ) : (
            <Link2 className="size-4" aria-hidden />
          )
        }
      >
        {copied ? (labels?.copied ?? "Copied!") : (labels?.copyLink ?? "Copy link")}
      </Button>
      <a href={xHref} target="_blank" rel="noreferrer noopener" className={anchorClass}>
        <Twitter className="size-4 text-cyan" aria-hidden />
        {labels?.postOnX ?? "Post on X"}
      </a>
      <a href={whatsAppHref} target="_blank" rel="noreferrer noopener" className={anchorClass}>
        <MessageCircle className="size-4 text-success" aria-hidden />
        {labels?.whatsApp ?? "WhatsApp"}
      </a>
    </div>
  );
}
