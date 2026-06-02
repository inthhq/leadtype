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
] as const;

const frameworkStartPages = [
  "quickstart",
  "optimization",
  "/ai-agents",
] as const;

const reactFrameworkNav = (title: string, base: string) => ({
  title,
  base,
  children: [
    { title: "Start", pages: [...frameworkStartPages] },
    { title: "Concepts", pages: [{ include: "concepts/*" }] },
    {
      title: "Guides",
      pages: [
        ...commonGuidePages,
        { include: "*", exclude: [...frameworkStartPages] },
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
    { title: "Start", pages: [...frameworkStartPages] },
    { title: "Concepts", pages: [{ include: "concepts/*" }] },
    { title: "Guides", pages: [...commonGuidePages] },
    { title: "Store API", pages: [{ include: "api/*" }] },
    { title: "Building Framework Libraries", pages: ["building-ui"] },
    { title: "IAB TCF", pages: [{ include: "iab/*" }] },
  ],
};

export default defineDocsConfig({
  product: {
    name: "c15t",
    tagline: "Developer-first consent management for modern web apps.",
  },
  organization: { name: "Inth", url: "https://inth.com" },
  // `llms.sections` fully describes the body of llms.txt in order. Use markdown
  // sections for prose/credibility content (popularity, hosting) and links
  // sections for curated, source-resolved entry points. Popularity numbers are
  // author-supplied here — fetch them at build time in this module if you
  // want them live; leadtype never fetches.
  llms: {
    sections: [
      {
        type: "markdown",
        heading: "Overview",
        body: [
          "- GDPR-ready cookie banners, consent dialogs, and preference flows",
          "- Framework guides for JavaScript, React, and Next.js",
          "- Load scripts, iframes, and analytics only after the required consent",
          "- Self-host the consent backend, or use managed hosting",
        ].join("\n"),
      },
      {
        type: "markdown",
        heading: "Popularity",
        body: "A widely adopted consent stack across the JavaScript ecosystem. Need a fully managed backend? Hosted by [Inth](https://inth.com).",
      },
      {
        type: "links",
        heading: "Best Starting Points",
        links: [
          { urlPath: "/docs/frameworks/next/quickstart" },
          { urlPath: "/docs/frameworks/react/quickstart" },
          { urlPath: "/docs/frameworks/javascript/quickstart" },
          { urlPath: "/docs/self-host/quickstart" },
        ],
      },
      {
        type: "markdown",
        heading: "Agent Guidance",
        body: "Start with the framework-specific quickstart for your target app. On the website, /docs/llms.txt routes by task and /llms-full.txt carries full page context; the bundled AGENTS.md lists the same topics as relative links.",
      },
    ],
  },
  collections: {
    docs: defineCollection({
      ...c15t,
      dir: "docs",
      prefix: "/docs",
      navigation: [
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
