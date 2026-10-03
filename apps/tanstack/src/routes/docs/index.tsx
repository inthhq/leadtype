"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import DocsIndex from "../../../../../docs/index.mdx";

export const Route = createFileRoute("/docs/")({
  component: DocsIndexRoute,
  head: () => createDocsHead("/docs"),
});

function DocsIndexRoute() {
  return <DocsIndex />;
}
