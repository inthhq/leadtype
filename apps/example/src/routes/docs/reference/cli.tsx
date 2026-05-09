"use client";

import { createFileRoute } from "@tanstack/react-router";
import CliDoc from "../../../../../../docs/reference/cli.mdx";

export const Route = createFileRoute("/docs/reference/cli")({
  component: CliRoute,
});

function CliRoute() {
  return <CliDoc />;
}
