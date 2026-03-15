import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/dist/**",
      "**/.typecheck/**",
      "electron/**/*.js",
    ],
  },
});
