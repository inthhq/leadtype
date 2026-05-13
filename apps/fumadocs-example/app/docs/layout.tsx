import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { FrameworkSwitcher } from "@/lib/framework-switcher";
import { leadtypeSource, source } from "@/lib/source";

// Build at render time on the server: every page that exists, so the
// switcher can fall back to /quickstart when the sibling page is missing.
const allPages = await leadtypeSource.listPages();
const knownRoutes = new Set(allPages.map((page) => page.urlPath));

/**
 * Top "tabs" that group docs by audience. Each tab points at its section's
 * landing route and matches every URL inside that section. fumadocs renders
 * these as a switcher above the sidebar.
 */
const sidebarTabs = [
  {
    title: "Frontend",
    description: "SDKs, components, hooks, and styling",
    url: "/docs/frameworks/next/quickstart",
    urls: new Set([
      "/docs/frameworks/next",
      "/docs/frameworks/react",
      "/docs/frameworks/javascript",
    ]),
  },
  {
    title: "Integrations",
    description: "Tag managers, analytics, and ad platforms",
    url: "/docs/integrations/overview",
    urls: new Set(["/docs/integrations"]),
  },
  {
    title: "Self Host",
    description: "Backend setup, deployment, and API reference",
    url: "/docs/self-host/quickstart",
    urls: new Set(["/docs/self-host"]),
  },
];

const navLinks = [{ text: "Changelog", url: "/changelog", external: false }];

export default function DocsRouteLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      links={navLinks}
      nav={{ title: "c15t docs" }}
      sidebar={{
        tabs: sidebarTabs,
        banner: <FrameworkSwitcher knownRoutes={knownRoutes} />,
      }}
      tree={source.pageTree}
    >
      {children}
    </DocsLayout>
  );
}
