// Vite build for the React islands mounted into Django templates.
//
// Two entries — the live generation workspace and the player/overlay feed —
// emitted with stable names into Django's static tree so templates can
// reference them without a manifest indirection. Shared code (React, the
// player runtime) lands in relatively-imported chunks, which resolve fine
// under /static/games/dist/islands/.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../games/static/games/dist/islands",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        workspace: "src/islands/workspace.tsx",
        overlay: "src/islands/overlay.tsx",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
