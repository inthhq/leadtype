import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

const navLinks = [{ text: "llms.txt", url: "/llms.txt", external: false }];

export default function ChangelogRouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DocsLayout
      links={navLinks}
      nav={{ title: "Leadtype" }}
      tree={source.pageTree}
    >
      {children}
    </DocsLayout>
  );
}
