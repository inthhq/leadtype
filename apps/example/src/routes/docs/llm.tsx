"use client";

import LlmDoc from "@docs/llm.mdx";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/llm")({
  component: LlmRoute,
});

function LlmRoute() {
  return <LlmDoc />;
}
