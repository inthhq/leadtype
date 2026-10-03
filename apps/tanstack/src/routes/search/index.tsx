"use client";

import { createFileRoute } from "@tanstack/react-router";
import { ProviderSearchTester } from "@/components/provider-search-tester";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { type DemoProviderId, providerIds } from "@/lib/provider-search";

export const Route = createFileRoute("/search/")({
  component: SearchIndexRoute,
  validateSearch: (search: Record<string, unknown>) => {
    const result: { provider?: DemoProviderId; q?: string } = {};
    if (providerIds.includes(search.provider as DemoProviderId)) {
      result.provider = search.provider as DemoProviderId;
    }
    if (typeof search.q === "string") {
      result.q = search.q;
    }
    return result;
  },
});

function SearchIndexRoute() {
  const { provider } = Route.useSearch();

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <ProviderSearchTester
        provider={provider ?? "vercel"}
        showChrome={false}
      />
      <SiteFooter />
    </div>
  );
}
