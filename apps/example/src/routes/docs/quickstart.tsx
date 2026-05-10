"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import QuickstartDoc from "../../../../../docs/quickstart.mdx";

export const Route = createFileRoute("/docs/quickstart")({
  component: QuickstartRoute,
  head: () => createDocsHead("/docs/quickstart"),
});

function QuickstartRoute() {
  return <QuickstartDoc />;
}
