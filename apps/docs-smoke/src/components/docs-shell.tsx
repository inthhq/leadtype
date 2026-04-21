"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { demoRoutes } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { SiteHeader } from "./site-header";

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <div className="min-h-svh">
      <SiteHeader />
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <h2 className="font-medium text-foreground text-sm">Routes</h2>
          <nav className="space-y-1">
            {demoRoutes
              .filter((route) => route.to !== "/")
              .map((route) => (
                <Link
                  className={cn(
                    "block rounded-md px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground",
                    pathname === route.to && "bg-secondary text-foreground"
                  )}
                  key={route.to}
                  to={route.to}
                >
                  {route.label}
                </Link>
              ))}
          </nav>
        </aside>
        <main className="min-w-0 rounded-2xl border border-border bg-card">
          <section className="docs-prose px-6 py-8 sm:px-8">{children}</section>
        </main>
      </div>
    </div>
  );
}
