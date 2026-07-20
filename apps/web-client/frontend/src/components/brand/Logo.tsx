import { Gamepad2 } from "lucide-react";
import { GradientText, cn } from "@codply/ui";
import type { ReactElement } from "react";

/**
 * The Codply wordmark — gamepad glyph + gradient "Codply". The brand is ALWAYS
 * the Latin wordmark, in every locale (it is not translated/transliterated in
 * Arabic). The icon scales with the surrounding font-size, so callers pick the
 * size with a text-* class: header uses `text-lg`, the login hero `text-3xl`.
 */
export function Logo({ className }: { className?: string }): ReactElement {
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-flex items-center gap-2 font-[family-name:var(--font-brand)] font-bold leading-none",
        className,
      )}
    >
      <Gamepad2 className="size-[1.15em] text-violet" aria-hidden />
      <GradientText>Codply</GradientText>
    </span>
  );
}
