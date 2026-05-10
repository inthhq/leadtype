"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import EvalsDoc from "../../../../../../docs/reference/evals.mdx";

export const Route = createFileRoute("/docs/reference/evals")({
  component: EvalsRoute,
  head: () => createDocsHead("/docs/reference/evals"),
});

function EvalsRoute() {
  return <EvalsDoc />;
}
