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

const scenarioContent = {
  consumer: {
    description:
      "Use `mdxComponents` as your starting map and style around the exported semantics rather than replacing everything.",
    title: "Consumer app",
  },
  pipeline: {
    description:
      "`AutoTypeTable` is validated during markdown conversion with a stable `basePath`, not in the live browser renderer.",
    title: "Pipeline test",
  },
  router: {
    description:
      "The app shell uses TanStack Start routes and shadcn-style cards, while the docs body renders the package adapters directly.",
    title: "Router shell",
  },
} as const;

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
              {(activeValue) => <ScenarioPanel activeValue={activeValue} />}
            </Selector>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function ScenarioPanel({ activeValue }: { activeValue: string }) {
  const content =
    activeValue in scenarioContent
      ? scenarioContent[activeValue as keyof typeof scenarioContent]
      : null;

  if (!content) {
    return null;
  }

  return (
    <div className="rounded-[1.25rem] border border-border/70 bg-background/70 p-5">
      <div className="space-y-2">
        <h2 className="font-semibold text-lg">{content.title}</h2>
        <p className="text-muted-foreground text-sm leading-7">
          {content.description}
        </p>
      </div>
    </div>
  );
}
