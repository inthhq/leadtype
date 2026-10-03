import { createFileRoute } from "@tanstack/react-router";
import { ProviderSearchTester } from "@/components/provider-search-tester";

export const Route = createFileRoute("/search/vercel")({
  component: VercelSearchRoute,
});

function VercelSearchRoute() {
  return <ProviderSearchTester provider="vercel" />;
}
