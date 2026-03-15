import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Keep desktop tests on TypeScript sources even when generated Electron JS
    // files sit beside them in the repo.
    extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"],
  },
  test: {
    exclude: [
      "**/dist/**",
      "**/.typecheck/**",
      "electron/**/*.js",
    ],
  },
});
