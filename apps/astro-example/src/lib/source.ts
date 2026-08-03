import path from "node:path";
import { createDocsProject } from "leadtype";
import docsConfig from "../../../../docs/docs.config";

const repoRoot = path.resolve(process.cwd(), "../..");

// The project reads the same resolved config the artifact pipeline reads, so
// navigation, mounts, the frontmatter schema, and the OpenAPI overlay are
// stated once — in the config — rather than restated here and left to drift.
// `configPath` fixes both the content root and where the config's relative
// paths resolve, using the same rules the CLI uses.
export const source = await createDocsProject({
  config: docsConfig,
  configPath: path.join(repoRoot, "docs", "docs.config.ts"),
  baseUrl: "http://localhost:4321",
  typeTableBasePath: repoRoot,
});
