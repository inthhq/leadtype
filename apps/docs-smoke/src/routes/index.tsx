import { createFileRoute, Link } from "@tanstack/react-router";
import { ComponentMatrix } from "@/components/component-matrix";
import { SiteHeader } from "@/components/site-header";
import { demoRoutes } from "@/lib/docs";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <div className="min-h-svh">
      <SiteHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10 sm:px-6">
        <section className="space-y-5 border-border border-b pb-10">
          <div className="space-y-2">
            <h1 className="font-heading font-medium text-4xl text-foreground tracking-tight">
              Reference app for `@inth/docs`
            </h1>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-medium text-foreground text-sm">
              Consumer contract
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-secondary p-4 text-foreground text-sm">
              <code>{`import { mdxComponents } from "@inth/docs";

const components = {
  ...mdxComponents,
};`}</code>
            </pre>
          </div>
        </section>
        <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <h2 className="font-heading font-medium text-2xl text-foreground tracking-tight">
              Coverage
            </h2>
            <ComponentMatrix />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading font-medium text-foreground text-lg tracking-tight">
              Routes
            </h2>
            <div className="mt-4 space-y-1">
              {demoRoutes
                .filter((route) => route.to !== "/")
                .map((route) => (
                  <Link
                    className="block rounded-md px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground"
                    key={route.to}
                    to={route.to}
                  >
                    <div className="font-medium text-foreground">
                      {route.label}
                    </div>
                    <p className="mt-1 text-muted-foreground text-sm leading-6">
                      {route.description}
                    </p>
                  </Link>
                ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
