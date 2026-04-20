import { AutoTypeTable, Callout } from "@inth/docs";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import DocsIndex from "../../../content/docs/index.mdx";

const getAutoTypeTableExample = createServerFn({ method: "GET" }).handler(
  async () => {
    const [{ extractTypeFromFile }, { existsSync }, { resolve }] =
      await Promise.all([
        import("@inth/docs/remark"),
        import("node:fs"),
        import("node:path"),
      ]);

    const rootCandidates = [process.cwd(), resolve(process.cwd(), "..", "..")];
    const repoRoot =
      rootCandidates.find((candidate) =>
        existsSync(
          resolve(
            candidate,
            "apps/docs-smoke/type-fixtures/pipeline-example.ts"
          )
        )
      ) ?? process.cwd();

    return {
      type:
        extractTypeFromFile(
          "./apps/docs-smoke/type-fixtures/pipeline-example.ts",
          "PipelineExampleOptions",
          repoRoot
        ) ?? null,
    };
  }
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
