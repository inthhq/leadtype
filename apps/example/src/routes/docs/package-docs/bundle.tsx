"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import BundleDoc from "../../../../../../docs/package-docs/bundle.mdx";

export const Route = createFileRoute("/docs/package-docs/bundle")({
  component: BundleRoute,
  head: () => createDocsHead("/docs/package-docs/bundle"),
});

function BundleRoute() {
  return <BundleDoc />;
}
