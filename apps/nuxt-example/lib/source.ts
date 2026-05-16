import path from "node:path";
import { createDocsSource } from "leadtype";
import docsConfig from "../../../examples/shared-docs/docs/docs.config";

const fixtureRoot = path.resolve(process.cwd(), "../../examples/shared-docs");

let sourcePromise: ReturnType<typeof createDocsSource> | undefined;

export function getSource() {
  sourcePromise ??= createDocsSource({
    contentDir: path.join(fixtureRoot, "docs"),
    groups: docsConfig.groups,
    baseUrl: "http://localhost:3000",
    typeTableBasePath: fixtureRoot,
  });
  return sourcePromise;
}
