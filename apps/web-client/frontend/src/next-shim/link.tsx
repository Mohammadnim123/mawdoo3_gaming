// next/link shim for ported Codply components running as Django-mounted islands.
// Navigation between top-level pages is a normal browser navigation here (Django
// owns routing), so Link renders a plain anchor. `prefetch`/`scroll` are accepted
// and ignored.
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: boolean;
  scroll?: boolean;
  replace?: boolean;
  children?: ReactNode;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _prefetch, scroll: _scroll, replace: _replace, children, ...rest },
  ref,
) {
  return (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  );
});

export default Link;
