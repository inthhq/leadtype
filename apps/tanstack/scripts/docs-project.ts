import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = fileURLToPath(new URL("..", import.meta.url));
export const repoRoot = join(appRoot, "..", "..");
export const generatedDir = join(appRoot, "src", "generated");
export const outDir = join(appRoot, "public");
export const packageRoot = dirname(
  fileURLToPath(import.meta.resolve("leadtype/package.json"))
);

// Both the CLI and runtime project must resolve links against this origin.
export const baseUrl =
  process.env.LEADTYPE_AGENT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  process.env.PORTLESS_URL?.trim() ||
  "https://leadtype.dev";
