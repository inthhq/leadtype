"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import LlmDoc from "../../../../../../docs/reference/llm.mdx";

export const Route = createFileRoute("/docs/reference/llm")({
  component: LlmRoute,
  head: () => createDocsHead("/docs/reference/llm"),
});

function LlmRoute() {
  return <LlmDoc />;
}
