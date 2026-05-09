"use client";

import { createFileRoute } from "@tanstack/react-router";
import ComponentsDoc from "../../../../../../docs/authoring/components.mdx";

export const Route = createFileRoute("/docs/authoring/components")({
  component: ComponentsRoute,
});

function ComponentsRoute() {
  return <ComponentsDoc />;
}
