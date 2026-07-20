"use client";

import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserRoundCheck, UserRoundPlus } from "lucide-react";
import { Button } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useFollowToggle } from "@/domain/hooks/useSocial";
import { useMe } from "@/domain/hooks/useMe";

/**
 * Follow/unfollow a creator (E16-F3). Hidden on your own handle; anonymous
 * clicks route to login. When the caller doesn't know the follow state
 * (game pages, overlay), it resolves from the profile cache.
 */
export function FollowButton({
  handle,
  following,
  size = "sm",
}: {
  handle: string;
  /** Known follow state; omit to resolve via GET /users/{handle}. */
  following?: boolean;
  size?: "sm" | "md";
}): ReactElement | null {
  const { t } = useI18n();
  const { data: me } = useMe();
  const self = me?.handle === handle;

  const profileQuery = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => getServices().social.profile(handle),
    enabled: following === undefined && !self,
    staleTime: 60_000,
  });
  const resolved = following ?? profileQuery.data?.viewer?.following ?? false;
  const { toggle } = useFollowToggle(handle, resolved);

  if (self) return null;

  return (
    <Button
      variant={resolved ? "soft" : "solid"}
      size={size}
      onClick={toggle}
      leftIcon={
        resolved ? (
          <UserRoundCheck className="size-4" aria-hidden />
        ) : (
          <UserRoundPlus className="size-4" aria-hidden />
        )
      }
    >
      {resolved ? t.profile.following : t.profile.follow}
    </Button>
  );
}
