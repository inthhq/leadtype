"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import FrontmatterDoc from "../../../../../../docs/authoring/frontmatter.mdx";

export const Route = createFileRoute("/docs/authoring/frontmatter")({
  component: FrontmatterRoute,
  head: () => createDocsHead("/docs/authoring/frontmatter"),
});

function FrontmatterRoute() {
  return <FrontmatterDoc />;
}
