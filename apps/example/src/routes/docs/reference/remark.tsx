"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import RemarkDoc from "../../../../../../docs/reference/remark.mdx";

export const Route = createFileRoute("/docs/reference/remark")({
  component: RemarkRoute,
  head: () => createDocsHead("/docs/reference/remark"),
});

function RemarkRoute() {
  return <RemarkDoc />;
}
