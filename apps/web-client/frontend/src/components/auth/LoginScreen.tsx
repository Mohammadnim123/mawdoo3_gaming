"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactElement } from "react";
import { KeyRound, LogIn, Mail, Send, UserPlus, Wand2 } from "lucide-react";
import { ApiError } from "@codply/contracts";
import { Button, Card, Input, Notice, SegmentedControl } from "@codply/ui";
import { getServices } from "@/domain/services";
import { Logo } from "@/components/brand/Logo";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuthProviders } from "@/domain/hooks/useAuthProviders";
import { OAuthButtons } from "./OAuthButtons";
import { PasswordField } from "./PasswordField";
import { safeNext } from "./safeNext";
import { useFinishLogin } from "./useFinishLogin";

/** Which panel the card shows. `auth` = OAuth row + password log in/sign up;
 * the magic-link pair keeps the pre-E37 phase machine (email → paste code). */
type View = "auth" | "magic-email" | "magic-sent" | "signup-sent";
type Mode = "login" | "signup";

/**
 * The E37 login screen: OAuth providers (from `GET /auth/providers`) on top,
 * then email+password with a Log in / Sign up toggle. "Email me a code
 * instead" opens the original magic-link flow — which still tries dev-login
 * first (instant JWT in dev); password submits never silently dev-login.
 */
export function LoginScreen(): ReactElement {
  const { t, f } = useI18n();
  const [view, setView] = useState<View>("auth");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicToken, setMagicToken] = useState("");
  const [inlineCode, setInlineCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const finishLogin = useFinishLogin();
  const nextTarget = safeNext(searchParams.get("next"));
  // The OAuth callback lands on /login?error=oauth for every failure mode
  // (bad state, exchange error, refused link) — one calm, generic notice.
  const oauthFailed = searchParams.get("error") === "oauth";

  const providersInfo = useAuthProviders();
  const oauthProviders = providersInfo?.providers ?? [];
  const passwordOn = providersInfo?.password ?? true;

  const fail = (err: unknown, fallback: string): void => {
    if (!ApiError.isApiError(err)) {
      setError(t.login.genericError);
    } else if (err.status === 401) {
      setError(fallback);
    } else {
      setError(err.message);
    }
  };

  const submitLogin = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await getServices().auth.loginPassword(email.trim(), password);
      await finishLogin(user, nextTarget);
    } catch (err) {
      fail(err, t.login.invalidCredentials);
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await getServices().auth.signup(email.trim(), password);
      setView("signup-sent");
    } catch (err) {
      fail(err, t.login.genericError);
    } finally {
      setBusy(false);
    }
  };

  const submitMagicEmail = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Dev-first fast path (magic flow ONLY): instant JWT when the API runs
      // in dev, 404 otherwise → the real magic-link request.
      const result = await getServices().auth.devLogin(email.trim());
      if ("user" in result) {
        await finishLogin(result.user, nextTarget);
        return;
      }
      const sent = await getServices().auth.requestMagicLink(email.trim());
      // While no mailer is configured the API hands the code back inline.
      setInlineCode(sent.code ?? null);
      if (sent.code) setMagicToken(sent.code);
      setView("magic-sent");
    } catch (err) {
      fail(err, t.login.genericError);
    } finally {
      setBusy(false);
    }
  };

  const submitToken = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (!magicToken.trim()) {
      setError(t.login.pasteCodeFirst);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await getServices().auth.verifyMagicLink(magicToken.trim());
      await finishLogin(user, nextTarget);
    } catch (err) {
      fail(err, t.login.linkDidNotWork);
    } finally {
      setBusy(false);
    }
  };

  const switchView = (next: View): void => {
    setView(next);
    setError(null);
  };

  const emailInput = (
    <Input
      label={t.login.email}
      type="email"
      required
      autoComplete="email"
      placeholder={t.login.emailPlaceholder}
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      leading={<Mail className="size-4" aria-hidden />}
      dir="ltr"
    />
  );

  const loginForm = (
    <form onSubmit={(e) => void submitLogin(e)} className="flex flex-col gap-4">
      {emailInput}
      <PasswordField
        label={t.login.password}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        required
        error={error ?? undefined}
      />
      <Button
        type="submit"
        variant="gradient-cta"
        loading={busy}
        leftIcon={<LogIn className="fp-flip-rtl size-4" aria-hidden />}
      >
        {t.login.logIn}
      </Button>
      <div className="flex flex-col items-center gap-1">
        <Link
          href="/forgot-password"
          className="text-sm text-ink-secondary underline-offset-4 hover:text-ink hover:underline"
        >
          {t.login.forgotPasswordLink}
        </Link>
        <Button type="button" variant="ghost" size="sm" onClick={() => switchView("magic-email")}>
          {t.login.emailCodeInstead}
        </Button>
      </div>
    </form>
  );

  const signupForm = (
    <form onSubmit={(e) => void submitSignup(e)} className="flex flex-col gap-4">
      {emailInput}
      <PasswordField
        label={t.login.password}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        required
        hint={t.login.passwordHint}
        error={error ?? undefined}
      />
      <Button
        type="submit"
        variant="gradient-cta"
        loading={busy}
        leftIcon={<UserPlus className="size-4" aria-hidden />}
      >
        {t.login.signUp}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => switchView("magic-email")}>
        {t.login.emailCodeInstead}
      </Button>
    </form>
  );

  const magicEmailForm = (
    <form onSubmit={(e) => void submitMagicEmail(e)} className="flex flex-col gap-4">
      <Input
        label={t.login.email}
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder={t.login.emailPlaceholder}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        leading={<Mail className="size-4" aria-hidden />}
        error={error ?? undefined}
        dir="ltr"
      />
      <Button
        type="submit"
        variant="gradient-cta"
        loading={busy}
        leftIcon={<Wand2 className="size-4" aria-hidden />}
      >
        {t.login.continueWithEmail}
      </Button>
      {passwordOn && (
        <Button type="button" variant="ghost" size="sm" onClick={() => switchView("auth")}>
          {t.login.usePasswordInstead}
        </Button>
      )}
      <p className="text-center text-xs text-ink-muted">{t.login.devHint}</p>
    </form>
  );

  const magicSentForm = (
    <form onSubmit={(e) => void submitToken(e)} className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-2xl border border-edge bg-surface-2 p-3 text-sm text-ink-secondary">
        <Send className="fp-flip-rtl mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
        {inlineCode ? (
          <span>{f.msg(t.login.inlineCodeNotice, { email })}</span>
        ) : (
          <span>{f.msg(t.login.linkSentNotice, { email })}</span>
        )}
      </div>
      <Input
        label={t.login.magicCodeLabel}
        required
        autoFocus
        placeholder={t.login.magicCodePlaceholder}
        value={magicToken}
        onChange={(e) => setMagicToken(e.target.value)}
        leading={<KeyRound className="size-4" aria-hidden />}
        error={error ?? undefined}
        dir="ltr"
      />
      <Button
        type="submit"
        variant="gradient-cta"
        loading={busy}
        leftIcon={<KeyRound className="size-4" aria-hidden />}
      >
        {t.login.verifyAndLogIn}
      </Button>
      <Button type="button" variant="ghost" onClick={() => switchView("magic-email")}>
        {t.login.useDifferentEmail}
      </Button>
    </form>
  );

  const signupSentPanel = (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-2xl border border-edge bg-surface-2 p-3 text-sm text-ink-secondary">
        <Send className="fp-flip-rtl mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
        <span>{f.msg(t.login.verifyEmailSentNotice, { email })}</span>
      </div>
      <Button type="button" variant="ghost" onClick={() => switchView("auth")}>
        {t.login.useDifferentEmail}
      </Button>
    </div>
  );

  const authPanel = (
    <div className="flex flex-col gap-4">
      {oauthFailed && <Notice tone="danger">{t.login.oauthFailed}</Notice>}
      {oauthProviders.length > 0 && (
        <>
          <OAuthButtons providers={oauthProviders} next={nextTarget} disabled={busy} />
          <div className="flex items-center gap-3" aria-hidden>
            <span className="flex-1 border-t border-edge" />
            <span className="text-xs uppercase text-ink-muted">{t.login.orDivider}</span>
            <span className="flex-1 border-t border-edge" />
          </div>
        </>
      )}
      {passwordOn ? (
        <>
          <SegmentedControl
            options={[
              { value: "login", label: t.login.logIn },
              { value: "signup", label: t.login.signUp },
            ]}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
            aria-label={t.login.authModeAria}
            className="self-center"
          />
          {mode === "login" ? loginForm : signupForm}
        </>
      ) : (
        magicEmailForm
      )}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 sm:py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="text-3xl" />
        <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
          {t.login.title}
        </h1>
        <p className="text-sm text-ink-secondary">{t.login.subtitle}</p>
      </div>

      <Card className="p-5">
        {view === "auth" && authPanel}
        {view === "magic-email" && magicEmailForm}
        {view === "magic-sent" && magicSentForm}
        {view === "signup-sent" && signupSentPanel}
      </Card>
    </div>
  );
}
