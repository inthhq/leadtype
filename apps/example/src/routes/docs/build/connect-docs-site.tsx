"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import ConnectDocsSiteDoc from "../../../../../../docs/build/connect-docs-site.mdx";

export const Route = createFileRoute("/docs/build/connect-docs-site")({
  component: ConnectDocsSiteRoute,
  head: () => createDocsHead("/docs/build/connect-docs-site"),
});

function ConnectDocsSiteRoute() {
  return <ConnectDocsSiteDoc />;
}
