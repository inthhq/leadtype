"use client";

import { createFileRoute } from "@tanstack/react-router";
import LintDoc from "../../../../../docs/lint.mdx";

export const Route = createFileRoute("/docs/lint")({
  component: LintRoute,
});

function LintRoute() {
  return <LintDoc />;
}
