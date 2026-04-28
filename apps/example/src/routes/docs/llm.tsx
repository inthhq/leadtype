"use client";

import { createFileRoute } from "@tanstack/react-router";
import LlmDoc from "../../../../../docs/llm.mdx";

export const Route = createFileRoute("/docs/llm")({
  component: LlmRoute,
});

function LlmRoute() {
  return <LlmDoc />;
}
