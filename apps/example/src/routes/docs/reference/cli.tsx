"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import CliDoc from "../../../../../../docs/reference/cli.mdx";

export const Route = createFileRoute("/docs/reference/cli")({
  component: CliRoute,
  head: () => createDocsHead("/docs/reference/cli"),
});

function CliRoute() {
  return <CliDoc />;
}
