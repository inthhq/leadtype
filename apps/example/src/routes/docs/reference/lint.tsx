"use client";

import { createFileRoute } from "@tanstack/react-router";
import LintDoc from "../../../../../../docs/reference/lint.mdx";

export const Route = createFileRoute("/docs/reference/lint")({
  component: LintRoute,
});

function LintRoute() {
  return <LintDoc />;
}
