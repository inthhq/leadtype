"use client";

import { createFileRoute } from "@tanstack/react-router";
import ComponentsDoc from "../../../../../docs/components.mdx";

export const Route = createFileRoute("/docs/components")({
  component: ComponentsRoute,
});

function ComponentsRoute() {
  return <ComponentsDoc />;
}
