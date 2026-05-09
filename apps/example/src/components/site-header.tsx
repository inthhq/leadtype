"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import { navigationRoutes } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { SearchBar } from "./search-bar";

function RobotIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect height="12" rx="2" width="16" x="4" y="8" />
      <path d="M12 4v4" />
      <circle cx="12" cy="3" r="1" />
      <path d="M9 13h.01M15 13h.01" />
      <path d="M9 17h6" />
      <path d="M2 14v2M22 14v2" />
    </svg>
  );
}

const TRAILING_SLASH_PATTERN = /\/$/;

function markdownHrefForPath(pathname: string): string | null {
  // Normalize first so /docs/ falls into the same bucket as /docs.
  const normalized = pathname.replace(TRAILING_SLASH_PATTERN, "");
  if (!(normalized === "/docs" || normalized.startsWith("/docs/"))) {
    return null;
  }
  if (normalized.endsWith(".md")) {
    return null;
  }
  if (normalized === "/docs") {
    return "/docs/index.md";
  }
  return `${normalized}.md`;
}

export function SiteHeader() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const markdownHref = markdownHrefForPath(pathname);

  return (
    <header className="sticky top-0 z-20 border-border border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <Link
          className="flex flex-col gap-0.5 font-heading font-medium text-base tracking-tight"
          to="/docs"
        >
          <span>leadtype</span>
        </Link>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <SearchBar />
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {markdownHref && (
              <a
                aria-label="View as Markdown (agent-friendly)"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                href={markdownHref}
                rel="noopener"
                target="_blank"
                title="View as Markdown"
              >
                <RobotIcon />
                <span className="sr-only">View as Markdown</span>
              </a>
            )}
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
