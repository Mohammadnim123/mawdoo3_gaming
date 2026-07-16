// Type stub for `import type { Route } from "next"` in ported components.
// These imports are type-only and erased at build; this satisfies tsc.
declare module "next" {
  export type Route = string;
  export type Metadata = Record<string, unknown>;
  export namespace MetadataRoute {
    type Robots = Record<string, unknown>;
    type Sitemap = Array<Record<string, unknown>>;
  }
}
