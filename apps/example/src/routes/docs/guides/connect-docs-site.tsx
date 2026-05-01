"use client";

import { createFileRoute } from "@tanstack/react-router";
import ConnectDocsSiteDoc from "../../../../../../docs/guides/connect-docs-site.mdx";

export const Route = createFileRoute("/docs/guides/connect-docs-site")({
  component: ConnectDocsSiteRoute,
});

function ConnectDocsSiteRoute() {
  return <ConnectDocsSiteDoc />;
}
