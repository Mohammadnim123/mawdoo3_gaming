"use client";

// Ported from the Codply reference `components/nav/TopBar.tsx` — verbatim:
// the site-wide `TopBar` header (Logo · HeaderSearch · Create · Bell ·
// AccountMenu) plus the account-menu half the workspace shell imports. In the
// Django build the header itself is server-rendered (chrome/_topbar.html);
// the chrome island hydrates the interactive slots with the same components.

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Check,
  Gamepad2,
  Gift,
  Languages,
  LayoutDashboard,
  LogIn,
  LogOut,
  Settings,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { Avatar, Button, cn, useToast } from "@codply/ui";
import { Logo } from "@/components/brand/Logo";
import { LOCALES, type Locale } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useInvalidateMe, useMe } from "@/domain/hooks/useMe";
import { useSubscription } from "@/domain/hooks/useCredits";
import { hasDailyClaim } from "@/domain/billing";
import { getServices } from "@/domain/services";
import { CreditsDialog } from "@/components/account/CreditsDialog";
import { useClaimDaily } from "@/components/account/useClaimDaily";
import { NotificationBell } from "@/components/social/NotificationBell";
import { HeaderSearch } from "@/components/search/HeaderSearch";

const LOCALE_NAMES: Record<Locale, string> = { en: "English", ar: "العربية" };

/** Top navigation: wordmark, feed link, Create CTA and the account menu. */
export function TopBar(): ReactElement {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b border-edge-subtle bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="rounded-2xl" aria-label={t.nav.codplyHome}>
          <Logo className="text-lg" />
        </Link>

        <HeaderSearch />

        <nav className="flex items-center gap-2" aria-label={t.nav.primary}>
          <Link href="/create" className="hidden md:block">
            <Button variant="gradient-cta" size="sm" leftIcon={<Sparkles className="size-4" aria-hidden />}>
              {t.nav.create}
            </Button>
          </Link>
          <NotificationBell />
          <AccountMenu />
        </nav>
      </div>
    </header>
  );
}

/** English / العربية rows — reused by the account menu (E33). */
function LanguageMenuItems({ onDone }: { onDone: () => void }): ReactElement {
  const { t, locale, setLocale } = useI18n();
  return (
    <>
      <p className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs text-ink-muted">
        <Languages className="size-3.5" aria-hidden />
        {t.nav.language}
      </p>
      {LOCALES.map((option) => (
        <MenuButton
          key={option}
          onClick={() => {
            onDone();
            setLocale(option);
          }}
        >
          <span className="w-4">
            {option === locale && <Check className="size-4 text-violet" aria-hidden />}
          </span>
          {LOCALE_NAMES[option]}
        </MenuButton>
      ))}
    </>
  );
}

/** Logged-out language toggle: one tap switches to the other locale. */
function LanguageToggle(): ReactElement {
  const { t, locale, setLocale } = useI18n();
  const other: Locale = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      onClick={() => setLocale(other)}
      aria-label={t.nav.language}
      className={cn(
        "fp-hit flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm text-ink-secondary",
        "transition-colors duration-150 ease-out hover:bg-surface-1 hover:text-ink",
      )}
      data-testid="language-toggle"
    >
      <Languages className="size-4" aria-hidden />
      {LOCALE_NAMES[other]}
    </button>
  );
}

/** Avatar dropdown — shared by the site TopBar and the workspace shell. */
export function AccountMenu(): ReactElement {
  const { t } = useI18n();
  const { data: me, isPending } = useMe();
  const [open, setOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const invalidateMe = useInvalidateMe();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // E29: the daily claim only exists on plans that carry it (free today).
  const subscription = useSubscription(Boolean(me));
  const { claim, claiming } = useClaimDaily();
  const showClaimDaily =
    subscription.data !== undefined && hasDailyClaim(subscription.data.plan);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (isPending) {
    return <div className="size-8 rounded-full bg-surface-2" aria-hidden />;
  }

  if (!me) {
    return (
      <span className="flex items-center gap-1.5">
        <LanguageToggle />
        <Link href="/login">
          <Button variant="soft" size="sm" leftIcon={<LogIn className="size-4" aria-hidden />}>
            {t.nav.logIn}
          </Button>
        </Link>
      </span>
    );
  }

  const logout = async (): Promise<void> => {
    setOpen(false);
    try {
      await getServices().auth.logout();
      await invalidateMe();
      // Feed/game caches carry per-viewer liked/saved state (E16) — flush
      // everything so the next reader never sees the previous user's hearts.
      queryClient.clear();
      router.push("/");
    } catch {
      toast({ title: t.nav.couldNotLogOut, variant: "error" });
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t.nav.accountMenu}
        className="flex items-center rounded-full"
      >
        <Avatar name={me.display_name ?? me.handle} src={me.avatar_url ?? undefined} size="sm" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-10 z-50 w-52 rounded-2xl border border-edge bg-surface-3 p-1.5"
        >
          <p className="truncate px-3 py-2 text-xs text-ink-muted" dir="ltr">
            @{me.handle}
          </p>
          <MenuLink href={`/u/${me.handle}`} onNavigate={() => setOpen(false)}>
            <UserRound className="size-4" aria-hidden />
            {t.nav.profile}
          </MenuLink>
          <MenuLink href="/me" onNavigate={() => setOpen(false)}>
            <Gamepad2 className="size-4" aria-hidden />
            {t.nav.myGamesAndAccount}
          </MenuLink>
          <MenuLink href="/me?tab=saved" onNavigate={() => setOpen(false)}>
            <Bookmark className="size-4" aria-hidden />
            {t.nav.savedGames}
          </MenuLink>
          <MenuLink href="/dashboard" onNavigate={() => setOpen(false)}>
            <LayoutDashboard className="size-4" aria-hidden />
            {t.profile.dashboard}
          </MenuLink>
          <MenuButton
            onClick={() => {
              setOpen(false);
              setCreditsOpen(true);
            }}
          >
            <Zap className="size-4 text-warning" aria-hidden />
            {t.nav.credits}
          </MenuButton>
          {showClaimDaily && (
            <MenuButton
              disabled={claiming}
              onClick={() => {
                setOpen(false);
                void claim();
              }}
            >
              <Gift className="size-4 text-cyan" aria-hidden />
              {t.nav.claimDaily}
            </MenuButton>
          )}
          <MenuLink href="/account/settings" onNavigate={() => setOpen(false)}>
            <Settings className="size-4" aria-hidden />
            {t.nav.settings}
          </MenuLink>
          <div className="my-1 border-t border-edge-subtle" role="separator">
            <LanguageMenuItems onDone={() => setOpen(false)} />
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-danger",
              "transition-colors duration-150 ease-out hover:bg-surface-2",
            )}
          >
            <LogOut className="size-4" aria-hidden />
            {t.nav.logOut}
          </button>
        </div>
      )}
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  );
}

function MenuLink({
  href,
  onNavigate,
  children,
}: {
  href: Route;
  onNavigate: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-secondary",
        "transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

function MenuButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-ink-secondary",
        "transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}
