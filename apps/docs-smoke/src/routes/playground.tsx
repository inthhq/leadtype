"use client";

import { Selector } from "@inth/docs";
import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/playground")({
  component: PlaygroundRoute,
});

function PlaygroundRoute() {
  return (
    <div className="min-h-svh">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <Badge>Direct component usage</Badge>
            <CardTitle>Selector playground</CardTitle>
            <CardDescription>
              `Selector` is easier to understand outside MDX because it relies
              on a render prop.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Selector
              defaultValue="consumer"
              label="Scenario"
              options={[
                { label: "Consumer app", value: "consumer" },
                { label: "Pipeline test", value: "pipeline" },
                { label: "Router shell", value: "router" },
              ]}
            >
              {(activeValue) => (
                <div className="rounded-[1.25rem] border border-border/70 bg-background/70 p-5">
                  {activeValue === "consumer" ? (
                    <div className="space-y-2">
                      <h2 className="font-semibold text-lg">Consumer app</h2>
                      <p className="text-muted-foreground text-sm leading-7">
                        Use `mdxComponents` as your starting map and style
                        around the exported semantics rather than replacing
                        everything.
                      </p>
                    </div>
                  ) : null}
                  {activeValue === "pipeline" ? (
                    <div className="space-y-2">
                      <h2 className="font-semibold text-lg">Pipeline test</h2>
                      <p className="text-muted-foreground text-sm leading-7">
                        `AutoTypeTable` is validated during markdown conversion
                        with a stable `basePath`, not in the live browser
                        renderer.
                      </p>
                    </div>
                  ) : null}
                  {activeValue === "router" ? (
                    <div className="space-y-2">
                      <h2 className="font-semibold text-lg">Router shell</h2>
                      <p className="text-muted-foreground text-sm leading-7">
                        The app shell uses TanStack Start routes and
                        shadcn-style cards, while the docs body renders the
                        package adapters directly.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </Selector>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
