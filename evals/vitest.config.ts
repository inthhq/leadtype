import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "evals/**/EVAL.ts", "llms/**/EVAL.ts"],
  },
});
