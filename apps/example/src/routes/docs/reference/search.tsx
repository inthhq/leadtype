"use client";

import { createFileRoute } from "@tanstack/react-router";
import SearchDoc from "../../../../../../docs/reference/search.mdx";

export const Route = createFileRoute("/docs/reference/search")({
  component: SearchRoute,
});

function SearchRoute() {
  return <SearchDoc />;
}
