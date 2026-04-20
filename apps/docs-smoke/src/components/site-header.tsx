"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import { demoRoutes } from "@/lib/docs";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <header className="sticky top-0 z-20 border-border border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <Link
          className="font-heading font-medium text-base tracking-tight"
          to="/"
        >
          @inth/docs
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {demoRoutes.map((route) => (
            <Link
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
    </header>
  );
}
