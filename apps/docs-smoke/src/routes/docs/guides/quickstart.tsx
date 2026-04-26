"use client";

import { createFileRoute } from "@tanstack/react-router";
import QuickstartDoc from "../../../../content/docs/guides/quickstart.mdx";

export const Route = createFileRoute("/docs/guides/quickstart")({
  component: QuickstartRoute,
});

function QuickstartRoute() {
  return <QuickstartDoc />;
}
