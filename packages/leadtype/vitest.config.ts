import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several CLI-integration tests shell out through `runCli` to lint, convert,
    // or generate against this repo's full docs tree. With the GEO + JSON-LD lint
    // rules that work is heavier per file, and the 5s vitest default is too tight
    // on slower CI runners (the lint-the-repo test clocked ~5.0s). Give them room.
    testTimeout: 30_000,
  },
});
