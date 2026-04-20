"use client";

import { createFileRoute } from "@tanstack/react-router";
import ComponentsFixtureDoc from "../../../../content/docs/guides/components-fixture.mdx";

export const Route = createFileRoute("/docs/guides/components-fixture")({
  component: ComponentsFixtureRoute,
});

function ComponentsFixtureRoute() {
  return <ComponentsFixtureDoc />;
}
