import { createFileRoute } from "@tanstack/react-router";
import { DocsShell } from "@/components/docs-shell";
import { createDocsHead } from "@/lib/docs-head";
import DocsIndex from "../../../../docs/index.mdx";

export const Route = createFileRoute("/")({
  component: HomeRoute,
  head: () => createDocsHead("/docs"),
});

function HomeRoute() {
  return (
    <DocsShell>
      <DocsIndex />
    </DocsShell>
  );
}
