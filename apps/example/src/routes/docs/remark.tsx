"use client";

import { createFileRoute } from "@tanstack/react-router";
import RemarkDoc from "../../../../../docs/remark.mdx";

export const Route = createFileRoute("/docs/remark")({
  component: RemarkRoute,
});

function RemarkRoute() {
  return <RemarkDoc />;
}
