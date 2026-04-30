"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { docsSidebarSections } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="space-y-5">
          {docsSidebarSections.map((section) => (
            <div className="space-y-2" key={section.title}>
              <h2 className="px-3 font-medium text-foreground text-xs uppercase tracking-wider">
                {section.title}
              </h2>
              <nav
                aria-label={`${section.title} documentation`}
                className="space-y-0.5"
              >
                {section.links.map((link) => (
                  <Link
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground",
                      pathname === link.to && "bg-secondary text-foreground"
                    )}
                    key={link.to}
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
        </aside>
        <main className="min-w-0 rounded-lg border border-border bg-card">
          <section className="docs-prose px-5 py-6 sm:px-7 sm:py-7">
            {children}
          </section>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
