"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactElement } from "react";
import { ArrowLeft, KeyRound, Mail, Send } from "lucide-react";
import { ApiError } from "@codply/contracts";
import { Button, Card, Input } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";

type Phase = "email" | "sent";

/**
 * /forgot-password (E37). The API is enumeration-safe — it ALWAYS answers
 * `{status:"sent"}` — so the sent state uses "if an account exists" copy.
 */
export function ForgotPasswordScreen(): ReactElement {
  const { t, f } = useI18n();
  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await getServices().auth.forgotPassword(email.trim());
      setPhase("sent");
    } catch (err) {
      setError(ApiError.isApiError(err) ? err.message : t.login.genericError);
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
          {t.login.forgotTitle}
        </h1>
        <p className="text-sm text-ink-secondary">{t.login.forgotSubtitle}</p>
      </div>

      <Card className="p-5">
        {phase === "email" ? (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
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
              leftIcon={<Send className="fp-flip-rtl size-4" aria-hidden />}
            >
              {t.login.sendResetLink}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2 rounded-2xl border border-edge bg-surface-2 p-3 text-sm text-ink-secondary">
              <Send className="fp-flip-rtl mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
              <span>{f.msg(t.login.forgotSentNotice, { email })}</span>
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-center">
          <Link
            href="/login"
            className="fp-hit flex items-center gap-1.5 text-sm text-ink-secondary transition-colors duration-150 ease-out hover:text-ink"
          >
            <ArrowLeft className="fp-flip-rtl size-4" aria-hidden />
            {t.login.backToLogin}
          </Link>
        </div>
      </Card>
    </div>
  );
}
