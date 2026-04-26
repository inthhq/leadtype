import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Callout, ExtractedTypeTable } from "@/components/docs-mdx";
import DocsIndex from "../../../content/docs/index.mdx";

const routeDirectory = dirname(fileURLToPath(import.meta.url));
const docsSmokeRoot = resolve(routeDirectory, "..", "..", "..");
const repoRoot = resolve(docsSmokeRoot, "..", "..");
const extractedTypeTableExamplePromise = (async () => {
  const { extractTypeFromFile } = await import("@inth/docs/remark");

  return {
    properties:
      extractTypeFromFile(
        "./apps/docs-smoke/type-fixtures/pipeline-example.ts",
        "PipelineExampleOptions",
        repoRoot
      ) ?? null,
  };
})();

const getExtractedTypeTableExample = createServerFn({ method: "GET" }).handler(
  async () => extractedTypeTableExamplePromise
);

export const Route = createFileRoute("/docs/")({
  loader: async () => getExtractedTypeTableExample(),
  component: DocsIndexRoute,
});

function DocsIndexRoute() {
  const { properties } = Route.useLoaderData();

  return (
    <>
      <DocsIndex />
      <h2>ExtractedTypeTable</h2>
      {properties ? (
        <ExtractedTypeTable
          name="PipelineExampleOptions"
          path="./apps/docs-smoke/type-fixtures/pipeline-example.ts"
          properties={properties}
        />
      ) : (
        <Callout title="ExtractedTypeTable" variant="canary">
          Could not extract `PipelineExampleOptions` from the fixture file.
        </Callout>
      )}
    </>
  );
}
