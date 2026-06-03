import path from "node:path";
import { createDocsSource } from "leadtype";
import docsConfig from "../../../../docs/docs.config";

const repoRoot = path.resolve(process.cwd(), "../..");

export const source = await createDocsSource({
  contentDir: path.join(repoRoot, "docs"),
  nav: docsConfig.navigation,
  baseUrl: "http://localhost:4321",
  typeTableBasePath: repoRoot,
});
