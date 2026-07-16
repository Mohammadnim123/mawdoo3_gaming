// Vite build for the React islands mounted into Django templates.
//
// Two entries — the live generation workspace and the player/overlay feed —
// emitted with stable names into Django's static tree so templates can
// reference them without a manifest indirection. Shared code (React, the
// player runtime) lands in relatively-imported chunks, which resolve fine
// under /static/games/dist/islands/.
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Vendored Codply packages — imports stay verbatim in ported components.
      "@codply/ui": r("./src/vendor/codply-ui/index.ts"),
      "@codply/game-runtime": r("./src/vendor/game-runtime/index.ts"),
      "@codply/contracts": r("./src/vendor/contracts/index.ts"),
      // Next.js shims for ported app components (Django owns routing).
      "next/link": r("./src/next-shim/link.tsx"),
      "next/navigation": r("./src/next-shim/navigation.ts"),
      "next/image": r("./src/next-shim/image.tsx"),
      "@": r("./src"),
    },
  },
  build: {
    outDir: "../games/static/games/dist/islands",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        workspace: "src/islands/workspace.tsx",
        overlay: "src/islands/overlay.tsx",
        create: "src/islands/create.tsx",
        feed: "src/islands/feed.tsx",
        game: "src/islands/game.tsx",
        account: "src/islands/account.tsx",
        settings: "src/islands/settings.tsx",
        billing: "src/islands/billing.tsx",
        dashboard: "src/islands/dashboard.tsx",
        notifications: "src/islands/notifications.tsx",
        search: "src/islands/search.tsx",
        profile: "src/islands/profile.tsx",
        auth: "src/islands/auth.tsx",
        chrome: "src/islands/chrome.tsx",
        legal: "src/islands/legal.tsx",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
