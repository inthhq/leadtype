import Link from "next/link";
import { nav } from "@/lib/manifest";

/**
 * Sidebar + header tabs derived entirely from `leadtype/navigation`. The active
 * page is known from the route's urlPath (server-rendered, no client state).
 */
export function DocsSidebar({ urlPath }: { urlPath: string }) {
  const tabs = nav.getHeaderTabs();
  const sections = nav.getSidebarSections(urlPath);

  return (
    <nav aria-label="Docs navigation" className="docs-sidebar">
      <ul className="docs-tabs">
        {tabs.map((tab) => (
          <li key={tab.groupKey ?? tab.to}>
            <Link
              aria-current={
                nav.isHeaderTabActive(urlPath, tab) ? "page" : undefined
              }
              href={tab.to}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
      {sections.map((section) => (
        <section className="docs-section" key={section.title}>
          <h2>{section.title}</h2>
          <ul>
            {section.links.map((link) => (
              <li key={link.to}>
                <Link
                  aria-current={link.to === urlPath ? "page" : undefined}
                  href={link.to}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
