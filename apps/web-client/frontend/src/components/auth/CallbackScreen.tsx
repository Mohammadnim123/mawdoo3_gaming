"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, Notice } from "@codply/ui";
import { getServices } from "@/domain/services";
import { Logo } from "@/components/brand/Logo";
import { useI18n } from "@/components/i18n/I18nProvider";
import { safeNext } from "./safeNext";
import { useFinishLogin } from "./useFinishLogin";

/**
 * /auth/callback?code=&next= (E37) — where the API's OAuth callback lands the
 * browser. Exchanges the one-time login code (60 s TTL, single-use — never a
 * JWT in a URL) for the session cookie, then redirects to the safe `next`.
 */
export function CallbackScreen(): ReactElement {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const nextTarget = safeNext(searchParams.get("next"));
  const [failed, setFailed] = useState(false);
  const finishLogin = useFinishLogin();
  // StrictMode mounts effects twice in dev — the code is single-use, so a
  // double exchange would 401 the second call and flash the error state.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!code) {
      setFailed(true);
      return;
    }
    void (async () => {
      try {
        const user = await getServices().auth.oauthComplete(code);
        await finishLogin(user, nextTarget);
      } catch {
        setFailed(true);
      }
    })();
  }, [code, nextTarget, finishLogin]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 sm:py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="text-3xl" />
        <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
          {t.login.title}
        </h1>
      </div>

      <Card className="p-5">
        {failed ? (
          <div className="flex flex-col gap-4">
            <Notice tone="danger">{t.login.oauthFailed}</Notice>
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
            {t.login.completingSignIn}
          </div>
        )}
      </Card>
    </div>
  );
}
