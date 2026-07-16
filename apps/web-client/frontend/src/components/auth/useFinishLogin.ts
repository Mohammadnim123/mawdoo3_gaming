"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "@codply/contracts";
import { useToast } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useInvalidateMe } from "@/domain/hooks/useMe";

/**
 * The ONE post-login sequence every auth surface funnels through (E37):
 * flush anonymous caches, refetch `/me`, welcome toast, redirect.
 */
export function useFinishLogin(): (user: User, next: Route) => Promise<void> {
  const { t, f } = useI18n();
  const queryClient = useQueryClient();
  const invalidateMe = useInvalidateMe();
  const { toast } = useToast();
  const router = useRouter();

  return async (user, next) => {
    // Anonymous caches carry viewer:null engagement state (E16) — flush so
    // the feed immediately reflects this account's likes/saves/follows.
    queryClient.clear();
    await invalidateMe();
    const name = user.display_name ?? user.handle;
    toast({ title: f.msg(t.login.welcome, { name }), variant: "success" });
    router.push(next);
  };
}
