"use client";

import { useState, type ComponentType, type ReactElement, type SVGProps } from "react";
import { Button } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Messages } from "@/domain/i18n";
import { AppleIcon, DiscordIcon, GoogleIcon } from "./ProviderIcons";

export interface OAuthButtonsProps {
  /** Configured providers from GET /auth/providers, in canonical order. */
  providers: readonly string[];
  /** Internal path to land on after the OAuth round-trip. */
  next: string;
  /** Disable the row while the surrounding form is busy. */
  disabled?: boolean;
}

interface KnownProvider {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: (t: Messages) => string;
}

/** Providers this screen knows how to draw — unknown wire values are skipped
 * (the array is OPEN by contract; a new provider must never break login). */
const KNOWN_PROVIDERS: Record<string, KnownProvider> = {
  google: { icon: GoogleIcon, label: (t) => t.login.continueWithGoogle },
  discord: { icon: DiscordIcon, label: (t) => t.login.continueWithDiscord },
  apple: { icon: AppleIcon, label: (t) => t.login.continueWithApple },
};

/**
 * One full-width soft button per configured OAuth provider (E37). Clicking
 * NAVIGATES to the API's start endpoint (302 to the provider) — the whole
 * row disables the moment one is chosen (the page is about to unload).
 */
export function OAuthButtons({ providers, next, disabled }: OAuthButtonsProps): ReactElement {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => {
        const known = KNOWN_PROVIDERS[provider];
        if (!known) return null;
        const Icon = known.icon;
        return (
          <Button
            key={provider}
            type="button"
            variant="soft"
            size="lg"
            className="w-full"
            disabled={disabled || leaving}
            leftIcon={<Icon className="size-5" />}
            onClick={() => {
              setLeaving(true);
              getServices().auth.oauthStart(provider, next);
            }}
          >
            {known.label(t)}
          </Button>
        );
      })}
    </div>
  );
}
