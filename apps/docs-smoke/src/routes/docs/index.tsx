import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AutoTypeTable, Callout } from "@inth/docs";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import DocsIndex from "../../../content/docs/index.mdx";

const routeDirectory = dirname(fileURLToPath(import.meta.url));
const docsSmokeRoot = resolve(routeDirectory, "..", "..", "..");
const repoRoot = resolve(docsSmokeRoot, "..", "..");
const autoTypeTableExamplePromise = (async () => {
  const { extractTypeFromFile } = await import("@inth/docs/remark");

  return {
    type:
      extractTypeFromFile(
        "./apps/docs-smoke/type-fixtures/pipeline-example.ts",
        "PipelineExampleOptions",
        repoRoot
      ) ?? null,
  };
})();

const getAutoTypeTableExample = createServerFn({ method: "GET" }).handler(
  async () => autoTypeTableExamplePromise
);

export const Route = createFileRoute("/docs/")({
  loader: async () => getAutoTypeTableExample(),
  component: DocsIndexRoute,
});

function DocsIndexRoute() {
  const { type } = Route.useLoaderData();

  return (
    <>
      <DocsIndex />
      <h2>AutoTypeTable</h2>
      {type ? (
        <AutoTypeTable
          name="PipelineExampleOptions"
          path="./apps/docs-smoke/type-fixtures/pipeline-example.ts"
          type={type}
        />
      ) : (
        <Callout title="AutoTypeTable" variant="canary">
          Could not extract `PipelineExampleOptions` from the fixture file.
        </Callout>
      )}
    </>
  );
}
