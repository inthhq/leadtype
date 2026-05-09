"use client";

import { createFileRoute } from "@tanstack/react-router";
import FrontmatterDoc from "../../../../../../docs/authoring/frontmatter.mdx";

export const Route = createFileRoute("/docs/authoring/frontmatter")({
  component: FrontmatterRoute,
});

function FrontmatterRoute() {
  return <FrontmatterDoc />;
}
