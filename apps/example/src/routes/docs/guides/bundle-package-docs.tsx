"use client";

import { createFileRoute } from "@tanstack/react-router";
import BundlePackageDocsDoc from "../../../../../../docs/guides/bundle-package-docs.mdx";

export const Route = createFileRoute("/docs/guides/bundle-package-docs")({
  component: BundlePackageDocsRoute,
});

function BundlePackageDocsRoute() {
  return <BundlePackageDocsDoc />;
}
