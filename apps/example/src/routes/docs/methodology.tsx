"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import MethodologyDoc from "../../../../../docs/methodology.mdx";

export const Route = createFileRoute("/docs/methodology")({
  component: MethodologyRoute,
  head: () => createDocsHead("/docs/methodology"),
});

function MethodologyRoute() {
  return <MethodologyDoc />;
}
