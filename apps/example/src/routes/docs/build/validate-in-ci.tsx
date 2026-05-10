"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import ValidateInCiDoc from "../../../../../../docs/build/validate-in-ci.mdx";

export const Route = createFileRoute("/docs/build/validate-in-ci")({
  component: ValidateInCiRoute,
  head: () => createDocsHead("/docs/build/validate-in-ci"),
});

function ValidateInCiRoute() {
  return <ValidateInCiDoc />;
}
