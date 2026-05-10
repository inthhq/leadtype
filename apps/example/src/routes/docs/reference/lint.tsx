"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import LintDoc from "../../../../../../docs/reference/lint.mdx";

export const Route = createFileRoute("/docs/reference/lint")({
  component: LintRoute,
  head: () => createDocsHead("/docs/reference/lint"),
});

function LintRoute() {
  return <LintDoc />;
}
