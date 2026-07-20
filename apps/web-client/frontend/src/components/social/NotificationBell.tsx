"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { Bell } from "lucide-react";
import { cn } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useUnreadCount } from "@/domain/hooks/useSocial";

/** TopBar bell with the unread badge (E16-F5). Hidden when logged out. */
export function NotificationBell(): ReactElement | null {
  const { t, f } = useI18n();
  const { data: me } = useMe();
  const unread = useUnreadCount();

  if (!me) return null;

  return (
    <Link
      href="/notifications"
      aria-label={
        unread > 0 ? f.msg(t.notifications.unreadAria, { count: unread }) : t.notifications.aria
      }
      className={cn(
        "relative flex size-9 items-center justify-center rounded-full text-ink-secondary",
        "transition-colors duration-150 ease-out hover:bg-surface-1 hover:text-ink",
      )}
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-ink-on-accent"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
