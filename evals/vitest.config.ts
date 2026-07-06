import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests for the harness itself. Fixture grading is done by the LLM
    // judge in the run scripts, not by vitest.
    include: ["lib/**/*.test.ts"],
  },
});
