import { createFileRoute, Link } from "@tanstack/react-router";
import { ComponentMatrix } from "@/components/component-matrix";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { navigationRoutes, packageSurfaces } from "@/lib/docs";

const START_ROUTE_PATHS = new Set(["/docs", "/playground", "/search"]);

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  const startRoutes = navigationRoutes.filter((route) =>
    START_ROUTE_PATHS.has(route.to)
  );

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-7 sm:px-6">
        <section className="grid gap-6 border-border border-b pb-8 lg:grid-cols-[minmax(280px,0.8fr)_minmax(460px,1.1fr)]">
          <div className="max-w-2xl space-y-4">
            <p className="font-medium text-accent-strong text-sm">
              Runtime docs, pipeline fixtures, and search demos
            </p>
            <h1 className="font-heading font-medium text-3xl text-foreground tracking-tight sm:text-4xl">
              Build docs with @inth/docs
            </h1>
            <p className="max-w-xl text-muted-foreground text-sm leading-7">
              Framework-neutral MDX conversion, LLM bundles, docs linting, and
              static search. This app owns its MDX components while rendering
              the package docs and keeping integration paths easy to test.
            </p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {startRoutes.map((route) => (
                <Link
                  className="rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-secondary"
                  key={route.to}
                  to={route.to}
                >
                  <span className="block font-medium text-sm">
                    {route.label}
                  </span>
                  <span className="mt-1 block text-muted-foreground text-xs leading-5">
                    {route.description}
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <div className="self-start rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-base text-foreground">
                  Implementation contract
                </p>
                <p className="max-w-xl text-muted-foreground text-sm leading-6">
                  Define the MDX component map in the docs app and spread it
                  into your MDX provider. The package owns conversion and
                  generation, not prebuilt UI.
                </p>
              </div>
              <Link
                className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
                to="/docs"
              >
                Open docs
              </Link>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-secondary p-4 text-foreground text-sm">
              <code>{`import { mdxComponents } from "@/components/docs-mdx";

export const components = {
  ...mdxComponents,
};`}</code>
            </pre>
          </div>
        </section>

        <section className="space-y-4">
          <div className="max-w-2xl space-y-2">
            <h2 className="font-heading font-medium text-2xl text-foreground tracking-tight">
              Package surfaces
            </h2>
            <p className="text-muted-foreground text-sm leading-6">
              The demo documents every public entry point so consumers can pick
              the smallest import path for their implementation.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="min-w-56 px-4 py-3 font-medium">Import</th>
                  <th className="min-w-32 px-4 py-3 font-medium">Use</th>
                  <th className="min-w-96 px-4 py-3 font-medium">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {packageSurfaces.map((surface) => (
                  <tr
                    className="border-border border-t align-top"
                    key={surface.importPath}
                  >
                    <td className="px-4 py-3 font-mono text-foreground text-sm">
                      {surface.importPath}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-secondary px-2 py-1 font-medium text-xs">
                        {surface.lifecycle}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {surface.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <div className="max-w-2xl space-y-2">
            <h2 className="font-heading font-medium text-2xl text-foreground tracking-tight">
              Smoke coverage
            </h2>
            <p className="text-muted-foreground text-sm leading-6">
              The app is also a regression harness for server rendering,
              hydration, conversion, generated search data, and agent docs.
            </p>
          </div>
          <ComponentMatrix />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
