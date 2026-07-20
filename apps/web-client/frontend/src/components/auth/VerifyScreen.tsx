"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Card, Notice } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useFinishLogin } from "./useFinishLogin";

/**
 * /auth/verify?token= (E37) — the page the emailed links open. Redeems the
 * login token (`purpose: magic_link | signup` — the API dispatches; a signup
 * token also activates the pending password) and finishes the login. This
 * page makes the emailed URLs real — they previously 404'd.
 */
export function VerifyScreen(): ReactElement {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [failed, setFailed] = useState(false);
  const finishLogin = useFinishLogin();
  // StrictMode mounts effects twice in dev — the token is single-use, so a
  // double redeem would 401 the second call and flash the error state.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!token) {
      setFailed(true);
      return;
    }
    void (async () => {
      try {
        const user = await getServices().auth.verifyToken(token);
        await finishLogin(user, "/create" as Route);
      } catch {
        setFailed(true);
      }
    })();
  }, [token, finishLogin]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 sm:py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl border border-edge bg-surface-1">
          <MailCheck className="size-6 text-violet" aria-hidden />
        </span>
        <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
          {t.login.title}
        </h1>
      </div>

      <Card className="p-5">
        {failed ? (
          <div className="flex flex-col gap-4">
            <Notice tone="danger">{t.login.linkDidNotWork}</Notice>
            <Link
              href="/login"
              className="fp-hit flex items-center justify-center gap-1.5 rounded-2xl border border-edge bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-3 hover:text-ink"
            >
              <ArrowLeft className="fp-flip-rtl size-4" aria-hidden />
              {t.login.backToLogin}
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-secondary">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t.login.verifying}
          </div>
        )}
      </Card>
    </div>
  );
}
