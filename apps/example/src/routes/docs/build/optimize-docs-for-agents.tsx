"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import OptimizeDocsForAgentsDoc from "../../../../../../docs/build/optimize-docs-for-agents.mdx";

export const Route = createFileRoute("/docs/build/optimize-docs-for-agents")({
  component: OptimizeDocsForAgentsRoute,
  head: () => createDocsHead("/docs/build/optimize-docs-for-agents"),
});

function OptimizeDocsForAgentsRoute() {
  return <OptimizeDocsForAgentsDoc />;
}
