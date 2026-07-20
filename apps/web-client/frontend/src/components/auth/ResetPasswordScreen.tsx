"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactElement } from "react";
import { KeyRound, RotateCcw } from "lucide-react";
import { ApiError } from "@codply/contracts";
import { Button, Card, Notice } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PasswordField } from "./PasswordField";
import { useFinishLogin } from "./useFinishLogin";

/**
 * /reset-password?token= (E37). Redeeming the token logs the user in AND
 * revokes every older JWT (auth epoch bump server-side). A missing or
 * rejected token lands on one error state: request a new link.
 */
export function ResetPasswordScreen(): ReactElement {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [tokenRejected, setTokenRejected] = useState(false);
  const finishLogin = useFinishLogin();

  const invalid = !token || tokenRejected;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || !token) return;
    setError(null);
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setBusy(true);
    try {
      const user = await getServices().auth.resetPassword(token, password);
      await finishLogin(user, "/create" as Route);
    } catch (err) {
      if (ApiError.isApiError(err) && err.status === 401) {
        setTokenRejected(true);
      } else {
        setError(ApiError.isApiError(err) ? err.message : t.login.genericError);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 sm:py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl border border-edge bg-surface-1">
          <KeyRound className="size-6 text-violet" aria-hidden />
        </span>
        <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
          {t.login.resetTitle}
        </h1>
        <p className="text-sm text-ink-secondary">{t.login.resetSubtitle}</p>
      </div>

      <Card className="p-5">
        {invalid ? (
          <div className="flex flex-col gap-4">
            <Notice tone="danger">{t.login.resetLinkInvalid}</Notice>
            <Link
              href="/forgot-password"
              className="fp-hit flex items-center justify-center gap-1.5 rounded-2xl border border-edge bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-3 hover:text-ink"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t.login.requestNewLink}
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <PasswordField
              label={t.login.newPassword}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              required
              autoFocus
              hint={t.login.passwordHint}
              error={error ?? undefined}
            />
            <PasswordField
              label={t.login.confirmPassword}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              required
              error={mismatch ? t.login.passwordsDoNotMatch : undefined}
            />
            <Button
              type="submit"
              variant="gradient-cta"
              loading={busy}
              leftIcon={<KeyRound className="size-4" aria-hidden />}
            >
              {t.login.resetSubmit}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
