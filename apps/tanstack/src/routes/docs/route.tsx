import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DocsShell } from "@/components/docs-shell";

export const Route = createFileRoute("/docs")({
  component: DocsRoute,
});

function DocsRoute() {
  return (
    <DocsShell>
      <Outlet />
    </DocsShell>
  );
}
