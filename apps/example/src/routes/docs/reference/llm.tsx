"use client";

import { createFileRoute } from "@tanstack/react-router";
import LlmDoc from "../../../../../../docs/reference/llm.mdx";

export const Route = createFileRoute("/docs/reference/llm")({
  component: LlmRoute,
});

function LlmRoute() {
  return <LlmDoc />;
}
