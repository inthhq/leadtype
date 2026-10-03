import { createFileRoute } from "@tanstack/react-router";
import { ProviderSearchTester } from "@/components/provider-search-tester";

export const Route = createFileRoute("/search/tanstack")({
  component: TanStackSearchRoute,
});

function TanStackSearchRoute() {
  return <ProviderSearchTester provider="tanstack" />;
}
