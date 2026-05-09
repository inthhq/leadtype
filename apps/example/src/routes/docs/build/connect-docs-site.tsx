"use client";

import { createFileRoute } from "@tanstack/react-router";
import ConnectDocsSiteDoc from "../../../../../../docs/build/connect-docs-site.mdx";

export const Route = createFileRoute("/docs/build/connect-docs-site")({
  component: ConnectDocsSiteRoute,
});

function ConnectDocsSiteRoute() {
  return <ConnectDocsSiteDoc />;
}
