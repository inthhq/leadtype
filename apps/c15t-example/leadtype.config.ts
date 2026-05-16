import { defineCollection, defineDocsConfig } from "leadtype";

const c15t = {
  repository: "https://github.com/c15t/c15t",
  ref: "main",
  // Keep the existing on-disk path so other scripts that reach into the
  // checkout (e.g. type-table generation) don't need to be reconfigured.
  cacheDir: ".docs-src/c15t",
} as const;

const commonGuidePages = [
  "script-loader",
  "iframe-blocking",
  "network-blocker",
  "callbacks",
  "internationalization",
  "policy-packs",
];

const frameworkStartPages = ["quickstart", "optimization", "/ai-agents"];

const reactFrameworkNav = (title: string, base: string) => ({
  title,
  base,
  children: [
    { title: "Start", pages: frameworkStartPages },
    { title: "Concepts", pages: [{ include: "concepts/*" }] },
    {
      title: "Guides",
      pages: [
        ...commonGuidePages,
        { include: "*", exclude: frameworkStartPages },
      ],
    },
    { title: "Components", pages: [{ include: "components/*" }] },
    { title: "Styling", pages: [{ include: "styling/*" }] },
    { title: "Hooks", pages: [{ include: "hooks/**/*" }] },
    { title: "IAB TCF", pages: [{ include: "iab/*" }] },
  ],
});

const javascriptFrameworkNav = {
  title: "JavaScript",
  base: "frameworks/javascript",
  children: [
    { title: "Start", pages: frameworkStartPages },
    { title: "Concepts", pages: [{ include: "concepts/*" }] },
    { title: "Guides", pages: commonGuidePages },
    { title: "Store API", pages: [{ include: "api/*" }] },
    { title: "Building Framework Libraries", pages: ["building-ui"] },
    { title: "IAB TCF", pages: [{ include: "iab/*" }] },
  ],
};

export default defineDocsConfig({
  product: {
    name: "c15t",
    summary: "Developer-first consent management for modern web apps.",
  },
  collections: {
    docs: defineCollection({
      ...c15t,
      dir: "docs",
      prefix: "/docs",
      nav: [
        {
          title: "Frontend",
          children: [
            reactFrameworkNav("Next.js", "frameworks/next"),
            reactFrameworkNav("React", "frameworks/react"),
            javascriptFrameworkNav,
          ],
        },
        {
          title: "Integrations",
          base: "integrations",
          pages: [{ include: "**/*" }],
        },
        {
          title: "Self Host",
          base: "self-host",
          pages: [{ include: "**/*" }],
        },
        {
          title: "Reference",
          pages: [{ include: "cli/*" }, { include: "oss/*" }],
        },
      ],
    }),
    changelog: defineCollection({
      ...c15t,
      dir: "changelog",
      prefix: "/changelog",
    }),
  },
});
