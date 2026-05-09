"use client";

import { createFileRoute } from "@tanstack/react-router";
import BundlePackageDocsDoc from "../../../../../../docs/build/bundle-package-docs.mdx";

export const Route = createFileRoute("/docs/build/bundle-package-docs")({
  component: BundlePackageDocsRoute,
});

function BundlePackageDocsRoute() {
  return <BundlePackageDocsDoc />;
}
