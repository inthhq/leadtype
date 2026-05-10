"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import ComponentsDoc from "../../../../../../docs/authoring/components.mdx";

export const Route = createFileRoute("/docs/authoring/components")({
  component: ComponentsRoute,
  head: () => createDocsHead("/docs/authoring/components"),
});

function ComponentsRoute() {
  return <ComponentsDoc />;
}
