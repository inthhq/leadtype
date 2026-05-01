"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import { navigationRoutes } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { SearchBar } from "./search-bar";

export function SiteHeader() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <header className="sticky top-0 z-20 border-border border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <Link
          className="flex flex-col gap-0.5 font-heading font-medium text-base tracking-tight"
          to="/"
        >
          <span>@inth/docs</span>
        </Link>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <SearchBar />
          <nav className="flex flex-wrap gap-1 text-sm">
            {navigationRoutes.map((route) => (
              <Link
                aria-current={pathname === route.to ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                  pathname === route.to && "bg-secondary text-foreground"
                )}
                key={route.to}
                to={route.to}
              >
                {route.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
