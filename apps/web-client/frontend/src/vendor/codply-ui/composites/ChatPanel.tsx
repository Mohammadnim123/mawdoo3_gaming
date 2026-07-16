"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { motion } from "framer-motion";
import { Bot, SendHorizonal } from "lucide-react";
import { transition } from "../tokens";
import { cn } from "../lib/cn";
import { Chip } from "../primitives/Chip";
import { IconButton } from "../primitives/IconButton";

export interface ChatPanelMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  /** Optimistic message not yet acknowledged by the API. */
  pending?: boolean;
}

export interface ChatPanelProps {
  messages: ChatPanelMessage[];
  /** Assistant text currently streaming in (rendered after `messages`). */
  streamingText?: string;
  /** Show the typing indicator (job running, nothing streamed yet). */
  typing?: boolean;
  /** Quick-reply option chips shown above the input. */
  options?: string[];
  onOptionSelect?: (option: string) => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Studio chat: message list (auto-scrolls), streaming/typing states, option
 * chips and the composer. Controlled — no data fetching inside.
 */
export function ChatPanel({
  messages,
  streamingText,
  typing = false,
  options = [],
  onOptionSelect,
  inputValue,
  onInputChange,
  onSend,
  disabled = false,
  placeholder = "Describe your change… (“make enemies faster and add a double jump”)",
  className,
}: ChatPanelProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, typing]);

  const send = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !disabled) onSend(trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col rounded-2xl border border-edge bg-surface-1", className)}
      data-testid="chat-panel"
    >
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        aria-live="polite"
      >
        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}
        {streamingText !== undefined && streamingText !== "" && (
          <ChatBubble
            message={{ id: "streaming", role: "assistant", content: streamingText }}
            streaming
          />
        )}
        {typing && !streamingText && (
          <div className="flex items-center gap-2 text-ink-muted" data-testid="typing-indicator">
            <Bot className="size-4 text-violet" aria-hidden />
            <span className="flex gap-1" aria-label="Assistant is working">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1.5 rounded-full bg-ink-muted"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {options.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-edge-subtle px-4 py-2">
          {options.map((option) => (
            <Chip key={option} onClick={() => onOptionSelect?.(option)} disabled={disabled}>
              {option}
            </Chip>
          ))}
        </div>
      )}

      {/* Composer row sticks to the panel bottom; safe-area padding keeps it
          clear of the iOS home indicator when the panel touches the viewport. */}
      <div className="flex items-end gap-2 border-t border-edge-subtle p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        <textarea
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Chat message"
          className={cn(
            "max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-edge bg-surface-2 px-3 py-2.5",
            // text-base (16px) prevents iOS focus zoom; single-line placeholder
            // ellipsizes instead of clipping in the one-row composer.
            "text-base text-ink placeholder:text-ink-muted [&::placeholder]:truncate",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
            "disabled:opacity-50",
          )}
        />
        <IconButton
          icon={SendHorizonal}
          aria-label="Send message"
          variant="solid"
          onClick={send}
          disabled={disabled || inputValue.trim() === ""}
          className="border-violet/50 bg-violet/15 text-violet hover:bg-violet/25"
        />
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  streaming = false,
}: {
  message: ChatPanelMessage;
  streaming?: boolean;
}): ReactElement {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.fast}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
      data-role={message.role}
    >
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl border px-3.5 py-2.5 text-sm",
          isUser
            ? "border-violet/40 bg-violet/15 text-ink"
            : "border-edge bg-surface-2 text-ink-secondary",
          message.pending && "opacity-60",
        )}
      >
        {message.content}
        {streaming && (
          <span className="fp-pulse ms-1 inline-block h-3.5 w-1.5 rounded-sm bg-cyan align-middle" aria-hidden />
        )}
      </div>
    </motion.div>
  );
}
