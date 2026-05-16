import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDocsSource } from "leadtype";
import docsConfig from "../../../../examples/shared-docs/docs/docs.config";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureRootCandidates = [
  path.resolve(process.cwd(), "../../examples/shared-docs"),
  path.resolve(process.cwd(), "examples/shared-docs"),
  path.resolve(appDir, "../../../../examples/shared-docs"),
];
const fixtureRoot =
  fixtureRootCandidates.find((candidate) => existsSync(candidate)) ??
  fixtureRootCandidates[0];

export const source = await createDocsSource({
  contentDir: path.join(fixtureRoot, "docs"),
  groups: docsConfig.groups,
  baseUrl: "http://localhost:5173",
  typeTableBasePath: fixtureRoot,
});
