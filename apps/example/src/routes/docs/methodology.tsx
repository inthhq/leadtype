"use client";

import { createFileRoute } from "@tanstack/react-router";
import MethodologyDoc from "../../../../../docs/methodology.mdx";

export const Route = createFileRoute("/docs/methodology")({
  component: MethodologyRoute,
});

function MethodologyRoute() {
  return <MethodologyDoc />;
}
