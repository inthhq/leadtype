"use client";

import { createFileRoute } from "@tanstack/react-router";
import SearchDoc from "../../../../../docs/search.mdx";

export const Route = createFileRoute("/docs/search")({
  component: SearchDocsRoute,
});

function SearchDocsRoute() {
  return <SearchDoc />;
}
