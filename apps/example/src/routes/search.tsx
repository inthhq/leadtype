import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/search")({
  component: SearchRoute,
});

function SearchRoute() {
  return <Outlet />;
}
