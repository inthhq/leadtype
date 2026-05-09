"use client";

import { createFileRoute } from "@tanstack/react-router";
import QuickstartDoc from "../../../../../docs/quickstart.mdx";

export const Route = createFileRoute("/docs/quickstart")({
  component: QuickstartRoute,
});

function QuickstartRoute() {
  return <QuickstartDoc />;
}
