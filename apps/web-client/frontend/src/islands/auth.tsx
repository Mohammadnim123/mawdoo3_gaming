// Entry: mounts one of the five auth screens into the Django auth pages.
// The server only picks WHICH screen ({screen} in the island props) — every
// screen reads its own URL params (?next=, ?token=, ?code=, ?error=, ?mode=)
// client-side via the next/navigation shim, exactly like the reference pages
// (app/{login,forgot-password,reset-password}/page.tsx and
// app/auth/{verify,callback}/page.tsx), so deep links behave identically.
import type { ComponentType } from "react";

import { CallbackScreen } from "@/components/auth/CallbackScreen";
import { ForgotPasswordScreen } from "@/components/auth/ForgotPasswordScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { ResetPasswordScreen } from "@/components/auth/ResetPasswordScreen";
import { VerifyScreen } from "@/components/auth/VerifyScreen";
import { mountIsland } from "./lib/mount";

type AuthScreen = "login" | "forgot" | "reset" | "verify" | "callback";

/** Server-rendered island props. Only `screen` drives the mount — the rest
 * (next/mode/token/error) ride the URL and are read client-side. */
interface AuthIslandProps {
  screen?: AuthScreen;
  next?: string;
  mode?: string;
  token?: string;
  error?: string;
}

const SCREENS: Record<AuthScreen, ComponentType> = {
  login: LoginScreen,
  forgot: ForgotPasswordScreen,
  reset: ResetPasswordScreen,
  verify: VerifyScreen,
  callback: CallbackScreen,
};

mountIsland("auth-island", (props: AuthIslandProps) => {
  const Screen = SCREENS[props.screen ?? "login"] ?? LoginScreen;
  return <Screen />;
});
