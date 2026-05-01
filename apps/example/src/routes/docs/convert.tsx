"use client";

import { createFileRoute } from "@tanstack/react-router";
import ConvertDoc from "../../../../../docs/convert.mdx";

export const Route = createFileRoute("/docs/convert")({
  component: ConvertRoute,
});

function ConvertRoute() {
  return <ConvertDoc />;
}
