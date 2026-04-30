"use client";

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Callout,
  CommandTabs,
  Selector,
  Tab,
  Tabs,
  TypeTable,
} from "@/components/docs-mdx";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const recipes = {
  render: {
    title: "Render MDX",
    summary:
      "Define the MDX component map in your docs app when it renders authored MDX in React.",
    imports: `import { mdxComponents } from "@/components/docs-mdx";`,
    code: `export const components = {
  ...mdxComponents,
};`,
    validation: "bun run --filter example test:e2e",
  },
  convert: {
    title: "Convert For Agents",
    summary:
      "Use the conversion and remark entry points when agents need plain markdown.",
    imports: `import { convertAllMdx } from "@inth/docs/convert";
import { defaultRemarkPlugins, remarkInclude } from "@inth/docs/remark";`,
    code: `await convertAllMdx({
  srcDir: "content",
  outDir: "public",
  remarkPlugins: [remarkInclude, ...defaultRemarkPlugins],
});`,
    validation: "bun run --filter example pipeline:build",
  },
  search: {
    title: "Search And Answer",
    summary:
      "Use the generated index for local search, then stream answers only when a user asks.",
    imports: `import { searchDocs } from "@inth/docs/search";
import { streamDocsAnswer } from "@inth/docs/search/vercel";`,
    code: `const results = searchDocs(index, query, { content });

const { response } = streamDocsAnswer({
  index,
  content,
  query,
  model,
  productName: "@inth/docs",
});`,
    validation: "bun run --filter example pipeline:search",
  },
} as const;

type RecipeKey = keyof typeof recipes;

function isRecipeKey(value: string): value is RecipeKey {
  return value in recipes;
}

export const Route = createFileRoute("/playground")({
  component: PlaygroundRoute,
});

function PlaygroundRoute() {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-7 sm:px-6">
        <section className="grid gap-4 border-border border-b pb-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-end">
          <div className="space-y-1.5">
            <p className="font-medium text-accent-strong text-sm">
              Guided recipes
            </p>
            <h1 className="font-heading font-medium text-2xl tracking-tight">
              Recipes playground
            </h1>
          </div>
          <p className="max-w-3xl text-muted-foreground text-sm leading-6">
            Switch between implementation paths and inspect exact imports,
            minimal code, live behavior, and the validation command without
            losing the working area to explanatory chrome.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <Selector
            defaultValue="render"
            label="Recipe"
            options={[
              { label: "Render MDX", value: "render" },
              { label: "Convert For Agents", value: "convert" },
              { label: "Search And Answer", value: "search" },
            ]}
          >
            {(activeValue) => <RecipePanel activeValue={activeValue} />}
          </Selector>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function RecipePanel({ activeValue }: { activeValue: string }) {
  const recipe = isRecipeKey(activeValue) ? recipes[activeValue] : null;

  if (!recipe) {
    return null;
  }

  return (
    <div className="grid gap-5 pt-2">
      <div className="space-y-1.5">
        <h2 className="font-heading font-medium text-xl tracking-tight">
          {recipe.title}
        </h2>
        <p className="max-w-2xl text-muted-foreground text-sm leading-6">
          {recipe.summary}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <h3 className="font-medium text-sm">Exact imports</h3>
          <pre className="overflow-x-auto rounded-lg border border-border bg-secondary p-4 text-sm">
            <code>{recipe.imports}</code>
          </pre>
        </section>
        <section className="space-y-3">
          <h3 className="font-medium text-sm">Minimal code</h3>
          <pre className="overflow-x-auto rounded-lg border border-border bg-secondary p-4 text-sm">
            <code>{recipe.code}</code>
          </pre>
        </section>
      </div>

      <section className="border-border border-t pt-5">
        <h3 className="font-medium text-sm">Live app behavior</h3>
        <div className="mt-4">
          <RecipePreview activeValue={activeValue} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium text-sm">Validation command</h3>
        <pre className="overflow-x-auto rounded-lg border border-border bg-secondary p-4 text-sm">
          <code>{recipe.validation}</code>
        </pre>
      </section>
    </div>
  );
}

function RecipePreview({ activeValue }: { activeValue: string }) {
  if (activeValue === "convert") {
    return (
      <CommandTabs
        command="bun run --filter example pipeline:{pm}"
        commands={{
          bun: "bun run --filter example pipeline:build",
          npm: "npm --workspace example run pipeline:build",
          pnpm: "pnpm --filter example pipeline:build",
          yarn: "yarn workspace example pipeline:build",
        }}
        defaultManager="bun"
      />
    );
  }

  if (activeValue === "search") {
    return (
      <div className="space-y-4">
        <TypeTable
          properties={{
            searchDocs: {
              type: "(index, query, options) => DocsSearchResult[]",
              description: "Returns local ranked results from static JSON.",
              required: true,
            },
            streamDocsAnswer: {
              type: "(options) => { response, sources }",
              description: "Streams source-grounded text through the AI SDK.",
            },
          }}
        />
        <Link
          className="inline-flex rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
          search={{ q: undefined }}
          to="/search"
        >
          Open live search
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Callout title="Runtime components" variant="success">
        The default `mdxComponents` map keeps authored MDX semantic while the
        host app owns the surrounding shell and styling.
      </Callout>
      <Tabs items={["Author", "Render"]}>
        <Tab value="Author">
          Write MDX with app-owned components such as `Callout`, `Tabs`,
          `Cards`, and `TypeTable`.
        </Tab>
        <Tab value="Render">
          Spread `mdxComponents` into your MDX provider and override individual
          entries only when the product needs custom styling.
        </Tab>
      </Tabs>
    </div>
  );
}
