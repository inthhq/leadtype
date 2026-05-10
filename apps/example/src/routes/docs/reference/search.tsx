"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import SearchDoc from "../../../../../../docs/reference/search.mdx";

export const Route = createFileRoute("/docs/reference/search")({
  component: SearchRoute,
  head: () => createDocsHead("/docs/reference/search"),
});

function SearchRoute() {
  return <SearchDoc />;
}
