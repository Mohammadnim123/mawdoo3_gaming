"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuthProvidersResponse } from "@codply/contracts";
import { getServices } from "../services";

export const AUTH_PROVIDERS_QUERY_KEY = ["auth", "providers"] as const;

/**
 * Which login methods the API has configured (E37): password on/off + the
 * OAuth providers in canonical order. `undefined` while loading — the login
 * screen renders no OAuth row until the answer is known (no button flash).
 * On error it falls back to password-only so email login always works.
 */
export function useAuthProviders(): AuthProvidersResponse | undefined {
  const query = useQuery({
    queryKey: AUTH_PROVIDERS_QUERY_KEY,
    queryFn: () => getServices().auth.providers(),
    // Which providers are configured changes on deploys, not mid-session.
    staleTime: Infinity,
    retry: 1,
  });
  if (query.isError) return { password: true, providers: [] };
  return query.data;
}
