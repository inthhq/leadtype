"use client";

import { createFileRoute } from "@tanstack/react-router";
import ConvertDoc from "../../../../../../docs/reference/convert.mdx";

export const Route = createFileRoute("/docs/reference/convert")({
  component: ConvertRoute,
});

function ConvertRoute() {
  return <ConvertDoc />;
}
