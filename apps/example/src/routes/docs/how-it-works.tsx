"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import HowItWorksDoc from "../../../../../docs/how-it-works.mdx";

export const Route = createFileRoute("/docs/how-it-works")({
  component: HowItWorksRoute,
  head: () => createDocsHead("/docs/how-it-works"),
});

function HowItWorksRoute() {
  return <HowItWorksDoc />;
}
