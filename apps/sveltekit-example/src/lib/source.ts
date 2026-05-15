import path from "node:path";
import { createDocsSource } from "leadtype";
import docsConfig from "../../../../examples/shared-docs/docs/docs.config";

const fixtureRoot = path.resolve(process.cwd(), "../../examples/shared-docs");

export const source = await createDocsSource({
  contentDir: path.join(fixtureRoot, "docs"),
  groups: docsConfig.groups,
  baseUrl: "http://localhost:5173",
  typeTableBasePath: fixtureRoot,
});
