"use client";

import { useState, type ReactElement } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { IconButton, Input } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";

export interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `current-password` (log in) or `new-password` (sign up / reset). */
  autoComplete: "current-password" | "new-password";
  error?: string;
  hint?: string;
  required?: boolean;
  autoFocus?: boolean;
  id?: string;
}

/**
 * Password input with a show/hide toggle in the Input's `trailing` slot
 * (E37). Passwords are an LTR island in RTL locales (like emails and codes).
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  required,
  autoFocus,
  id,
}: PasswordFieldProps): ReactElement {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <Input
      id={id}
      label={label}
      type={visible ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      required={required}
      autoFocus={autoFocus}
      error={error}
      hint={hint}
      dir="ltr"
      leading={<KeyRound className="size-4" aria-hidden />}
      trailing={
        <IconButton
          icon={visible ? EyeOff : Eye}
          size="sm"
          variant="ghost"
          aria-label={visible ? t.login.hidePassword : t.login.showPassword}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        />
      }
    />
  );
}
