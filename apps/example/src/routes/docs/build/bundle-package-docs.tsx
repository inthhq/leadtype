"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import BundlePackageDocsDoc from "../../../../../../docs/build/bundle-package-docs.mdx";

export const Route = createFileRoute("/docs/build/bundle-package-docs")({
  component: BundlePackageDocsRoute,
  head: () => createDocsHead("/docs/build/bundle-package-docs"),
});

function BundlePackageDocsRoute() {
  return <BundlePackageDocsDoc />;
}
