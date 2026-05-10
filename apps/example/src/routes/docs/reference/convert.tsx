"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import ConvertDoc from "../../../../../../docs/reference/convert.mdx";

export const Route = createFileRoute("/docs/reference/convert")({
  component: ConvertRoute,
  head: () => createDocsHead("/docs/reference/convert"),
});

function ConvertRoute() {
  return <ConvertDoc />;
}
