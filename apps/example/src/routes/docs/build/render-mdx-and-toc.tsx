"use client";

import { createFileRoute } from "@tanstack/react-router";
import { createDocsHead } from "@/lib/docs-head";
import RenderMdxAndTocDoc from "../../../../../../docs/build/render-mdx-and-toc.mdx";

export const Route = createFileRoute("/docs/build/render-mdx-and-toc")({
  component: RenderMdxAndTocRoute,
  head: () => createDocsHead("/docs/build/render-mdx-and-toc"),
});

function RenderMdxAndTocRoute() {
  return <RenderMdxAndTocDoc />;
}
