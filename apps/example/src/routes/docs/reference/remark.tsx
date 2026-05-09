"use client";

import { createFileRoute } from "@tanstack/react-router";
import RemarkDoc from "../../../../../../docs/reference/remark.mdx";

export const Route = createFileRoute("/docs/reference/remark")({
  component: RemarkRoute,
});

function RemarkRoute() {
  return <RemarkDoc />;
}
