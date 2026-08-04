import path from "node:path";
import { createDocsProject } from "leadtype";

const repoRoot = path.resolve(process.cwd(), "../..");

// No config import: the project discovers `docs/docs.config.ts` from the repo
// root and reads the same resolved model `generate`, `doctor`, and `nav` read.
export const source = await createDocsProject({
  cwd: repoRoot,
  baseUrl: "http://localhost:4321",
  typeTableBasePath: repoRoot,
});
