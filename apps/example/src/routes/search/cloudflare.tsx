import { createFileRoute } from "@tanstack/react-router";
import { ProviderSearchTester } from "@/components/provider-search-tester";

export const Route = createFileRoute("/search/cloudflare")({
  component: CloudflareSearchRoute,
});

function CloudflareSearchRoute() {
  return <ProviderSearchTester provider="cloudflare" />;
}
