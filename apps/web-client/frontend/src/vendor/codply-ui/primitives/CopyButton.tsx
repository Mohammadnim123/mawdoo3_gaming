"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";
import { IconButton, type IconButtonSize, type IconButtonVariant } from "./IconButton";

export interface CopyButtonProps {
  /** Text written to the clipboard on click. */
  text: string;
  /** Accessible name; flips to `copiedLabel` during the feedback window. */
  "aria-label"?: string;
  /** Accessible name while the check shows; default "Copied" (E33). */
  copiedLabel?: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  onCopied?: () => void;
  /** Feedback window in ms before the check reverts to the copy icon. */
  resetAfterMs?: number;
  className?: string;
}

/**
 * Copy-to-clipboard icon button with transient check feedback — chat bubbles,
 * URLs, snippets. Clipboard failures (permissions/insecure context) no-op.
 */
export function CopyButton({
  text,
  "aria-label": ariaLabel = "Copy",
  copiedLabel = "Copied",
  variant = "ghost",
  size = "sm",
  onCopied,
  resetAfterMs = 2000,
  className,
}: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.();
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), resetAfterMs);
    } catch {
      // Clipboard unavailable — leave state as-is.
    }
  }, [onCopied, resetAfterMs, text]);

  return (
    <IconButton
      icon={copied ? Check : Copy}
      aria-label={copied ? copiedLabel : ariaLabel}
      variant={variant}
      size={size}
      onClick={() => void copy()}
      className={cn(copied && "text-success", className)}
    />
  );
}
