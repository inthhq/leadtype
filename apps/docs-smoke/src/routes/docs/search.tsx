"use client";

import { createFileRoute } from "@tanstack/react-router";
import SearchDoc from "../../../content/docs/search.mdx";

export const Route = createFileRoute("/docs/search")({
  component: SearchDocsRoute,
});

function SearchDocsRoute() {
  return <SearchDoc />;
}
