import { defineLeadtypeConfig, gitSource } from "leadtype";

/**
 * The recommended pinned-source docs-UI shape, run against real production
 * content: this repo owns the site (identity, agent surfaces, deployment), and
 * c15t owns its docs. `inheritConfig` pulls the content-owned half of c15t's
 * own `docs/docs.config.ts` — navigation, frontmatter schema, flatteners,
 * mounts — so the information architecture stays with the people who write the
 * pages.
 *
 * Set `C15T_REF=<sha|tag|branch>` to point at a c15t PR branch locally.
 */
export default defineLeadtypeConfig({
  product: {
    name: "c15t",
    tagline: "Developer-first consent management.",
    homepage: "https://c15t.com",
    docs: "https://c15t.com/docs",
    repository: "https://github.com/c15t/c15t",
    kind: "library",
  },
  organization: {
    name: "c15t",
    url: "https://c15t.com",
  },
  // Site-owned, deliberately. c15t owns its navigation and this app inherits
  // it, but which pages an *agent* should start from is a publishing decision,
  // so it belongs here. Without it the derived starting points are simply the
  // first pages in navigation order, which for a large site is arbitrary.
  llms: {
    sections: [
      {
        type: "links",
        heading: "Best Starting Points",
        links: [
          { urlPath: "/docs" },
          { urlPath: "/docs/frameworks/react/quickstart" },
          { urlPath: "/docs/frameworks/next/quickstart" },
          { urlPath: "/docs/cli/quickstart" },
          { urlPath: "/docs/self-host/quickstart" },
        ],
      },
    ],
  },
  sources: {
    c15t: gitSource({
      repository: "https://github.com/c15t/c15t.git",
      // Pinned to a commit, following the advice this repo gives: a branch
      // renders different content tomorrow from the same config, and
      // `leadtype doctor` flags a mutable ref for exactly that reason.
      ref: process.env.C15T_REF ?? "2b89e689458497bc985862db21f6b4b03a918e46",
      cacheDir: "content-fixtures/c15t",
      // c15t is a monorepo and we need one docs directory out of it. `packages`
      // comes along because the docs use `<AutoTypeTable path="./packages/…">`
      // to render real prop tables from source — drop it and every type table
      // silently degrades.
      sparse: ["docs", "packages"],
      collections: {
        docs: {
          dir: "docs",
          routePrefix: "/docs",
          inheritConfig: true,
        },
      },
    }),
  },
  // `<AutoTypeTable path="./packages/…">` paths in c15t's MDX are relative to
  // the repository root, which is the clone — not this app.
  typeTableBasePath: "content-fixtures/c15t",
});
