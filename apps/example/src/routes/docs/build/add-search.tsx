"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import AddSearchDoc from "../../../../../../docs/build/add-search.mdx";

export const Route = createFileRoute("/docs/build/add-search")({
  component: AddSearchRoute,
  head: () => createDocsHead("/docs/build/add-search"),
});

function AddSearchRoute() {
  return <AddSearchDoc />;
}
