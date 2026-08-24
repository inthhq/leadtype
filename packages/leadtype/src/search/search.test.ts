import { describe, expect, it } from "vitest";
import { extractDocsTableOfContents } from "../llm/llm";
import {
  attachDocsSearchContent,
  createAnswerContext,
  createDocsSearchIndex,
  createMemoryRateLimiter,
  type DocsSearchContentStore,
  type DocsSearchDocument,
  DocsSearchRequestError,
  getClientIdentifier,
  listDocsContentFiles,
  readDocsContentChunk,
  readDocsContentFile,
  readJsonWithLimit,
  searchDocs,
  slugifyDocsHeading,
  validateDocsQuery,
} from "./index";

const CHUNK_ANCHOR_INDEX = 2;

const flattenTocIds = (
  items: ReturnType<typeof extractDocsTableOfContents>
): string[] => {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id, ...flattenTocIds(item.children));
  }
  return ids;
};

const docs: DocsSearchDocument[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    description: "Install and configure the package.",
    urlPath: "/docs/guides/quickstart",
    absoluteUrl: "https://leadtype.dev/docs/guides/quickstart",
    relativePath: "guides/quickstart",
    content: `---
title: Quickstart
---

# Quickstart

Install the package.

## CommandTabs

Use tabs to switch between npm, pnpm, and bun install commands.
`,
  },
  {
    id: "tabs",
    title: "Tabs",
    description: "Interactive tab controls.",
    urlPath: "/docs/components/tabs",
    absoluteUrl: "https://leadtype.dev/docs/components/tabs",
    relativePath: "components/tabs",
    content: `# Components

## Keyboard Navigation

Panels can be changed with arrow keys.
`,
  },
  {
    id: "body-only",
    title: "Components",
    description: "General component details.",
    urlPath: "/docs/components",
    absoluteUrl: "https://leadtype.dev/docs/components",
    relativePath: "components",
    content: `# Components

This page mentions tabs in body copy only.
`,
  },
  {
    id: "code",
    title: "Code",
    description: "Code examples.",
    urlPath: "/docs/code",
    absoluteUrl: "https://leadtype.dev/docs/code",
    relativePath: "code",
    content: `# Code

\`\`\`ts
const cafe = "café";
\`\`\`
`,
  },
];

describe("createDocsSearchIndex and searchDocs", () => {
  it("stores compact metadata separately from answer content", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(index.version).toBe(3);
    expect(index.documents[0]).toEqual([
      "quickstart",
      "Quickstart",
      "Install and configure the package.",
      "/docs/guides/quickstart",
      "https://leadtype.dev/docs/guides/quickstart",
      "guides/quickstart",
    ]);
    expect(index.chunks[0]).toHaveLength(6);
    expect(index.chunks[0]).not.toHaveProperty("text");
    expect(index.content?.version).toBe(3);
    expect(index.content?.chunks[0]).toContain("Install the package");
    expect(index.content?.codeChunks).toHaveLength(index.chunks.length);
    expect(
      index.content?.codeChunks.some((chunk) => chunk.includes("cafe"))
    ).toBe(true);
    expect(readDocsContentFile(index, "code")?.chunks[0]?.codeText).toContain(
      'const cafe = "café";'
    );
  });

  it("normalizes case, punctuation, and diacritics", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "CAFÉ!!!");

    expect(results[0]?.title).toBe("Code");
  });

  it("indexes and searches terms that collide with Object.prototype", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "proto",
          title: "Constructor Patterns",
          description: "Class constructor usage.",
          urlPath: "/docs/constructor",
          absoluteUrl: "https://leadtype.dev/docs/constructor",
          relativePath: "constructor",
          content:
            "# Constructor\n\nCall the constructor before hasOwnProperty checks.\n",
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    // Simulate the client path: a JSON.parse'd index has a normal prototype,
    // so "constructor" must not resolve to Object.prototype members.
    const parsed = JSON.parse(JSON.stringify(index)) as typeof index;

    const results = searchDocs(parsed, "constructor");

    expect(results[0]?.title).toBe("Constructor Patterns");
  });

  it("expands queries with synonyms while keeping exact matches first", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "setup package");

    expect(results[0]?.title).toBe("Quickstart");
    expect(results[0]?.excerpt).toContain("Install");
  });

  it("supports custom synonyms at query time", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "switcher", {
      synonyms: { switcher: ["keyboard"] },
    });

    expect(results[0]?.title).toBe("Tabs");
  });

  it("lets transformers customize search documents and chunks", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      transformers: [
        {
          name: "search-metadata",
          beforeSearchIndex(documents) {
            return documents.map((doc) => ({
              ...doc,
              description:
                doc.id === "quickstart"
                  ? `${doc.description} sdk bootstrap`
                  : doc.description,
            }));
          },
          beforeSearchChunk(chunk) {
            if (chunk.relativePath !== "guides/quickstart") {
              return;
            }
            return {
              ...chunk,
              text: `${chunk.text}\n\napiArea: onboarding`,
            };
          },
        },
      ],
    });

    expect(searchDocs(index, "bootstrap")[0]?.documentId).toBe("quickstart");
    expect(searchDocs(index, "onboarding")[0]?.documentId).toBe("quickstart");
  });

  it("does not index shared route documents by default", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "shared-script-loader",
          title: "Script loader",
          urlPath: "/docs/shared/react/guides/script-loader",
          absoluteUrl:
            "https://leadtype.dev/docs/shared/react/guides/script-loader",
          relativePath: "shared/react/guides/script-loader",
          content: "# Script loader\n\nAlways load the shared script.",
        },
        {
          id: "underscore-shared-script-loader",
          title: "Script loader",
          urlPath: "/docs/_shared/react/guides/script-loader",
          absoluteUrl:
            "https://leadtype.dev/docs/_shared/react/guides/script-loader",
          relativePath: "_shared/react/guides/script-loader",
          content: "# Script loader\n\nAlways load the _shared script.",
        },
        {
          id: "changelog-shared-template",
          title: "Release template",
          urlPath: "/changelog/_shared/release-template",
          absoluteUrl:
            "https://leadtype.dev/changelog/_shared/release-template",
          relativePath: "changelog/_shared/release-template",
          content: "# Release template\n\nShared changelog release notes.",
        },
        {
          id: "react-script-loader",
          title: "Script loader",
          urlPath: "/docs/frameworks/react/script-loader",
          absoluteUrl:
            "https://leadtype.dev/docs/frameworks/react/script-loader",
          relativePath: "frameworks/react/script-loader",
          content: "# Script loader\n\nAlways load the shared script.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(index.documents.map((document) => document[3])).toEqual([
      "/docs/frameworks/react/script-loader",
    ]);
    expect(searchDocs(index, "always load")).toHaveLength(1);
  });

  it("lets frontmatter opt shared routes into search", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "shared-public",
          title: "Shared public guide",
          urlPath: "/docs/shared/public-guide",
          absoluteUrl: "https://leadtype.dev/docs/shared/public-guide",
          relativePath: "shared/public-guide",
          frontmatter: { search: true },
          content: "# Shared public guide\n\nReusable concepts.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(index.documents[0]?.[3]).toBe("/docs/shared/public-guide");
    expect(searchDocs(index, "reusable")[0]?.urlPath).toBe(
      "/docs/shared/public-guide"
    );
  });

  it("lets frontmatter exclude public docs from search", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "private-preview",
          title: "Private preview",
          urlPath: "/docs/private-preview",
          absoluteUrl: "https://leadtype.dev/docs/private-preview",
          relativePath: "private-preview",
          frontmatter: { search: false },
          content: "# Private preview\n\nUnreleased preview details.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(index.documents).toEqual([]);
    expect(searchDocs(index, "unreleased")).toEqual([]);
  });

  it("falls back to prefix and typo-tolerant matches", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(searchDocs(index, "keyb")[0]?.title).toBe("Tabs");
    expect(searchDocs(index, "caff")[0]?.title).toBe("Code");
  });

  it("boosts phrase matches when content is available", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "phrase",
          title: "Guide",
          urlPath: "/docs/phrase",
          absoluteUrl: "https://leadtype.dev/docs/phrase",
          relativePath: "phrase",
          content: "# Guide\n\nInstall the package with the CLI.",
        },
        {
          id: "split",
          title: "Guide",
          urlPath: "/docs/split",
          absoluteUrl: "https://leadtype.dev/docs/split",
          relativePath: "split",
          content:
            "# Guide\n\nInstall the tool first. The package manager comes later.",
        },
      ],
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
      }
    );

    expect(searchDocs(index, "install package")[0]?.urlPath).toBe(
      "/docs/phrase"
    );
  });

  it("preserves heading paths in chunks and results", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = searchDocs(index, "pnpm")[0];

    expect(result?.headingPath).toEqual(["Quickstart", "CommandTabs"]);
  });

  it("adds hash URLs for the matched heading", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = searchDocs(index, "pnpm")[0];

    expect(result?.anchor).toBe("commandtabs");
    expect(result?.urlWithHash).toBe("/docs/guides/quickstart#commandtabs");
    expect(result?.absoluteUrlWithHash).toBe(
      "https://leadtype.dev/docs/guides/quickstart#commandtabs"
    );
  });

  it("suffixes repeated heading slugs like the rendered page and the TOC", () => {
    const content = [
      "# API Reference",
      "",
      "## createThing",
      "",
      "### Example",
      "",
      "Use createThing to build a widget alpha.",
      "",
      "## createOther",
      "",
      "### Example",
      "",
      "Use createOther to build a gadget beta.",
      "",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "api",
          title: "API Reference",
          urlPath: "/docs/api",
          absoluteUrl: "https://leadtype.dev/docs/api",
          relativePath: "api.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    // Both sections are titled "Example"; the second must not deep-link to
    // the first. `extractDocsTableOfContents` numbers them example/example-1.
    expect(searchDocs(index, "alpha")[0]?.urlWithHash).toBe(
      "/docs/api#example"
    );
    expect(searchDocs(index, "beta")[0]?.urlWithHash).toBe(
      "/docs/api#example-1"
    );
  });

  it("does not collide a generated suffix with a later literal slug", () => {
    const content = [
      "# Reference",
      "",
      "## API",
      "",
      "The first API section covers widgets.",
      "",
      "## API",
      "",
      "The second API section covers gadgets.",
      "",
      "## API-1",
      "",
      "The literal API-1 section covers sprockets.",
      "",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "reference",
          title: "Reference",
          urlPath: "/docs/reference",
          absoluteUrl: "https://leadtype.dev/docs/reference",
          relativePath: "reference.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "widgets")[0]?.urlWithHash).toBe(
      "/docs/reference#api"
    );
    expect(searchDocs(index, "gadgets")[0]?.urlWithHash).toBe(
      "/docs/reference#api-1"
    );
    expect(searchDocs(index, "sprockets")[0]?.urlWithHash).toBe(
      "/docs/reference#api-1-1"
    );
  });

  it("counts headings that produce no search chunk", () => {
    const content = [
      "# Reference",
      "",
      "## Example",
      "### Details",
      "",
      "Nested details cover widgets.",
      "",
      "## Example",
      "",
      "The later example covers sprockets.",
      "",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "reference",
          title: "Reference",
          urlPath: "/docs/reference",
          absoluteUrl: "https://leadtype.dev/docs/reference",
          relativePath: "reference.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "sprockets")[0]?.urlWithHash).toBe(
      "/docs/reference#example-1"
    );
  });

  it("reserves Setext headings before allocating later ATX anchors", () => {
    const content = [
      "Install",
      "=======",
      "",
      "The Setext section covers widgets.",
      "",
      "## Install",
      "",
      "The ATX section covers sprockets.",
      "",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "install",
          title: "Install",
          urlPath: "/docs/install",
          absoluteUrl: "https://leadtype.dev/docs/install",
          relativePath: "install.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "sprockets")[0]?.urlWithHash).toBe(
      "/docs/install#install-1"
    );
  });

  it("does not reserve a Setext anchor for an indented underline", () => {
    const content = [
      "Install",
      "    ---",
      "## Install",
      "The ATX section covers widgets.",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "install",
          title: "Install",
          urlPath: "/docs/install",
          absoluteUrl: "https://leadtype.dev/docs/install",
          relativePath: "install.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "widgets")[0]?.urlWithHash).toBe(
      "/docs/install#install"
    );
  });

  it("reserves inline-marked Setext headings before later ATX anchors", () => {
    const content = [
      '<em title="1 > 0">Install</em>',
      "---",
      "The Setext section covers widgets.",
      "## Install",
      "The ATX section covers sprockets.",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "install",
          title: "Install",
          urlPath: "/docs/install",
          absoluteUrl: "https://leadtype.dev/docs/install",
          relativePath: "install.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "sprockets")[0]?.urlWithHash).toBe(
      "/docs/install#install-1"
    );
  });

  it("does not reserve headings inside tilde code fences", () => {
    const content = [
      "# Reference",
      "",
      "~~~md",
      "## Example",
      "~~~",
      "",
      "## Example",
      "",
      "The real example covers widgets.",
      "",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "reference",
          title: "Reference",
          urlPath: "/docs/reference",
          absoluteUrl: "https://leadtype.dev/docs/reference",
          relativePath: "reference.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "widgets")[0]?.urlWithHash).toBe(
      "/docs/reference#example"
    );
  });

  it("keeps search anchors in the same order as TOC ids", () => {
    const fixtures = [
      [
        "# Reference",
        "Reference overview.",
        "## API",
        "First API overview.",
        "### Details",
        "Nested details cover widgets.",
        "## API",
        "The second API covers gadgets.",
        "## API-1",
        "The literal suffix covers sprockets.",
      ].join("\n"),
      [
        "Install",
        "=======",
        "Setext body covers widgets.",
        "## Install",
        "ATX body covers sprockets.",
      ].join("\n"),
      [
        "# Reference",
        "~~~md",
        "## Example",
        "~~~",
        "## Example",
        "The real example covers widgets.",
      ].join("\n"),
      [
        '<em title="1 > 0">Install</em>',
        "   ---",
        "Inline markup section covers widgets.",
        "## Install",
        "The ATX section covers sprockets.",
      ].join("\r\n"),
      [
        "<hgroup>Note</hgroup>",
        "---",
        "Inline HTML section covers widgets.",
        "## Note",
        "The ATX section covers sprockets.",
      ].join("\n"),
      [
        "Install <!-- don't -->",
        "---",
        "Inline comment section covers widgets.",
        "## Install",
        "The ATX section covers sprockets.",
      ].join("\n"),
    ];

    for (const content of fixtures) {
      const index = createDocsSearchIndex(
        [
          {
            id: "fixture",
            title: "Fixture",
            urlPath: "/docs/fixture",
            absoluteUrl: "https://leadtype.dev/docs/fixture",
            relativePath: "fixture.mdx",
            content,
          },
        ],
        { generatedAt: "2026-01-01T00:00:00.000Z" }
      );
      const tocIds = flattenTocIds(
        extractDocsTableOfContents(
          content,
          {
            urlPath: "/docs/fixture",
            absoluteUrl: "https://leadtype.dev/docs/fixture",
          },
          { minLevel: 1, maxLevel: 6 }
        )
      );
      const searchAnchors = index.chunks.map(
        (chunk) => chunk[CHUNK_ANCHOR_INDEX]
      );

      expect(searchAnchors.length).toBeGreaterThan(1);
      expect(searchAnchors).toEqual(tocIds);
    }
  });

  it("keeps inline HTML text in search heading labels", () => {
    const index = createDocsSearchIndex(
      [
        {
          id: "anchors",
          title: "Anchors",
          urlPath: "/docs/anchors",
          absoluteUrl: "https://leadtype.dev/docs/anchors",
          relativePath: "anchors.mdx",
          content: [
            "## Anchors and <code>#</code>",
            "Literal marker covers widgets.",
          ].join("\n"),
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    const result = searchDocs(index, "widgets")[0];
    expect(result?.headingPath.at(-1)).toBe("Anchors and #");
    expect(result?.urlWithHash).toBe("/docs/anchors#anchors-and");
  });

  it("keeps MDX member-expression heading labels aligned with anchors", () => {
    const content = [
      "## <Icons.Install /> Install",
      "Icon section covers widgets.",
      "## Install",
      "Plain section covers sprockets.",
      "## <Icons:Install /> Install",
      "Namespaced section covers calipers.",
      "## <_Icon /> Setup",
      "Underscore section covers ratchets.",
      "## <$Icon /> Configure",
      "Dollar section covers spanners.",
      "<components.Note>",
      "---",
      "</components.Note>",
      "## Components Note",
      "Member flow section covers gadgets.",
      "<span value={1 > 0}>",
      "---",
      "</span>",
      "## 0",
      "Expression section covers levels.",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "fixture",
          title: "Fixture",
          urlPath: "/docs/fixture",
          absoluteUrl: "https://leadtype.dev/docs/fixture",
          relativePath: "fixture.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );
    const tocIds = flattenTocIds(
      extractDocsTableOfContents(content, {
        urlPath: "/docs/fixture",
        absoluteUrl: "https://leadtype.dev/docs/fixture",
      })
    );
    const searchAnchors = index.chunks.map(
      (chunk) => chunk[CHUNK_ANCHOR_INDEX]
    );

    expect(searchAnchors).toEqual(tocIds);
    expect(searchDocs(index, "widgets")[0]?.urlWithHash).toBe(
      "/docs/fixture#install"
    );
    expect(searchDocs(index, "sprockets")[0]?.urlWithHash).toBe(
      "/docs/fixture#install-1"
    );
    expect(searchDocs(index, "calipers")[0]?.urlWithHash).toBe(
      "/docs/fixture#install-2"
    );
    expect(searchDocs(index, "ratchets")[0]?.urlWithHash).toBe(
      "/docs/fixture#setup"
    );
    expect(searchDocs(index, "spanners")[0]?.urlWithHash).toBe(
      "/docs/fixture#configure"
    );
    expect(searchDocs(index, "gadgets")[0]?.urlWithHash).toBe(
      "/docs/fixture#components-note"
    );
    expect(searchDocs(index, "levels")[0]?.urlWithHash).toBe("/docs/fixture#0");
  });

  it("keeps JavaScript literal MDX attributes aligned with rendered anchors", () => {
    const content = [
      "## <Badge pattern={/don't/} /> Install",
      "Regex section covers widgets.",
      "## <Badge onClick={() => { if (ready) {} /don't/.test(value); }} /> Install",
      "Statement section covers calipers.",
      "## <Badge value={{} / 2 > 0} /> Install",
      "Division section covers ratchets.",
      "## Install",
      "Plain section covers sprockets.",
      "<span value={/* don't > */ 1 > 0}>",
      "---",
      "</span>",
      "## 0",
      "Comparison section covers levels.",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "fixture",
          title: "Fixture",
          urlPath: "/docs/fixture",
          absoluteUrl: "https://leadtype.dev/docs/fixture",
          relativePath: "fixture.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );
    const tocIds = flattenTocIds(
      extractDocsTableOfContents(content, {
        urlPath: "/docs/fixture",
        absoluteUrl: "https://leadtype.dev/docs/fixture",
      })
    );
    const searchAnchors = index.chunks.map(
      (chunk) => chunk[CHUNK_ANCHOR_INDEX]
    );

    expect(tocIds).toEqual([
      "install",
      "install-1",
      "install-2",
      "install-3",
      "0",
    ]);
    expect(searchAnchors).toEqual(tocIds);
    expect(searchDocs(index, "widgets")[0]?.urlWithHash).toBe(
      "/docs/fixture#install"
    );
    expect(searchDocs(index, "sprockets")[0]?.urlWithHash).toBe(
      "/docs/fixture#install-3"
    );
    expect(searchDocs(index, "calipers")[0]?.urlWithHash).toBe(
      "/docs/fixture#install-1"
    );
    expect(searchDocs(index, "ratchets")[0]?.urlWithHash).toBe(
      "/docs/fixture#install-2"
    );
    expect(searchDocs(index, "levels")[0]?.urlWithHash).toBe("/docs/fixture#0");
  });

  it("keeps MDX fragment flow and inline heading anchors aligned", () => {
    const content = [
      "<>",
      "Install",
      "</>",
      "---",
      "<>Setup</>",
      "---",
      "Setext fragment section covers gadgets.",
      "## <>Install</>",
      "Fragment section covers widgets.",
      "## Install",
      "Plain section covers sprockets.",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "fixture",
          title: "Fixture",
          urlPath: "/docs/fixture",
          absoluteUrl: "https://leadtype.dev/docs/fixture",
          relativePath: "fixture.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );
    const tocIds = flattenTocIds(
      extractDocsTableOfContents(content, {
        urlPath: "/docs/fixture",
        absoluteUrl: "https://leadtype.dev/docs/fixture",
      })
    );
    const searchAnchors = index.chunks.map(
      (chunk) => chunk[CHUNK_ANCHOR_INDEX]
    );

    expect(tocIds).toEqual(["setup", "install", "install-1"]);
    expect(searchAnchors).toEqual(["", ...tocIds]);
    expect(searchDocs(index, "gadgets")[0]?.urlWithHash).toBe(
      "/docs/fixture#setup"
    );
    expect(searchDocs(index, "widgets")[0]?.headingPath.at(-1)).toBe("Install");
    expect(searchDocs(index, "widgets")[0]?.urlWithHash).toBe(
      "/docs/fixture#install"
    );
    expect(searchDocs(index, "sprockets")[0]?.urlWithHash).toBe(
      "/docs/fixture#install-1"
    );
  });

  it("keeps bare block starters aligned for LF and CRLF", () => {
    for (const blockStart of ["<pre", "<div", "<Callout"]) {
      for (const lineEnding of ["\n", "\r\n"]) {
        const content = [
          "Title",
          blockStart,
          "---",
          "## After",
          "After section covers widgets.",
        ].join(lineEnding);
        const index = createDocsSearchIndex(
          [
            {
              id: "fixture",
              title: "Fixture",
              urlPath: "/docs/fixture",
              absoluteUrl: "https://leadtype.dev/docs/fixture",
              relativePath: "fixture.mdx",
              content,
            },
          ],
          { generatedAt: "2026-01-01T00:00:00.000Z" }
        );
        const tocIds = flattenTocIds(
          extractDocsTableOfContents(content, {
            urlPath: "/docs/fixture",
            absoluteUrl: "https://leadtype.dev/docs/fixture",
          })
        );
        const searchAnchors = index.chunks.map(
          (chunk) => chunk[CHUNK_ANCHOR_INDEX]
        );

        expect(tocIds).toEqual(["after"]);
        expect(searchAnchors).toEqual(["", ...tocIds]);
      }
    }
  });

  it("keeps standalone HTML tags from shifting LF or CRLF heading anchors", () => {
    for (const lineEnding of ["\n", "\r\n"]) {
      const content = [
        '<span title="1 < 2 > 0">',
        "---",
        "</span>",
        "## !!!",
        "First punctuation section covers widgets.",
        "## !!!",
        "Second punctuation section covers sprockets.",
      ].join(lineEnding);
      const index = createDocsSearchIndex(
        [
          {
            id: "fixture",
            title: "Fixture",
            urlPath: "/docs/fixture",
            absoluteUrl: "https://leadtype.dev/docs/fixture",
            relativePath: "fixture.mdx",
            content,
          },
        ],
        { generatedAt: "2026-01-01T00:00:00.000Z" }
      );
      const tocIds = flattenTocIds(
        extractDocsTableOfContents(content, {
          urlPath: "/docs/fixture",
          absoluteUrl: "https://leadtype.dev/docs/fixture",
        })
      );
      const searchAnchors = index.chunks.map(
        (chunk) => chunk[CHUNK_ANCHOR_INDEX]
      );

      expect(tocIds).toEqual(["", "-1"]);
      expect(searchAnchors).toEqual(["", ...tocIds]);
    }
  });

  it("keeps comparison and declaration heading labels aligned with anchors", () => {
    const content = [
      "## 1 < 2 > 0",
      "Comparison section covers widgets.",
      "## Install <?don't?>",
      "Processing section covers sprockets.",
      "## Install <!THING don't>",
      "Declaration section covers gadgets.",
    ].join("\n");
    const index = createDocsSearchIndex(
      [
        {
          id: "fixture",
          title: "Fixture",
          urlPath: "/docs/fixture",
          absoluteUrl: "https://leadtype.dev/docs/fixture",
          relativePath: "fixture.mdx",
          content,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    const comparison = searchDocs(index, "widgets")[0];
    const processing = searchDocs(index, "sprockets")[0];
    const declaration = searchDocs(index, "gadgets")[0];
    const tocIds = flattenTocIds(
      extractDocsTableOfContents(content, {
        urlPath: "/docs/fixture",
        absoluteUrl: "https://leadtype.dev/docs/fixture",
      })
    );
    const searchAnchors = index.chunks.map(
      (chunk) => chunk[CHUNK_ANCHOR_INDEX]
    );

    expect(searchAnchors).toEqual(tocIds);
    expect(comparison?.headingPath.at(-1)).toBe("1 < 2 > 0");
    expect(comparison?.urlWithHash).toBe("/docs/fixture#1-2-0");
    expect(processing?.headingPath.at(-1)).toBe("Install");
    expect(processing?.urlWithHash).toBe("/docs/fixture#install");
    expect(declaration?.headingPath.at(-1)).toBe("Install");
    expect(declaration?.urlWithHash).toBe("/docs/fixture#install-1");
  });

  it("slugifies headings for hash links", () => {
    expect(slugifyDocsHeading("Café API: Quick Start!")).toBe(
      "cafe-api-quick-start"
    );
  });

  it("ranks title and heading matches above body-only matches", () => {
    const rankingDocs: DocsSearchDocument[] = [
      {
        id: "title",
        title: "Tabs",
        urlPath: "/docs/title",
        absoluteUrl: "https://leadtype.dev/docs/title",
        relativePath: "title",
        content: "# Overview\n\nShort body.",
      },
      {
        id: "heading",
        title: "Guide",
        urlPath: "/docs/heading",
        absoluteUrl: "https://leadtype.dev/docs/heading",
        relativePath: "heading",
        content: "# Guide\n\n## Tabs\n\nShort body.",
      },
      {
        id: "body",
        title: "Guide",
        urlPath: "/docs/body",
        absoluteUrl: "https://leadtype.dev/docs/body",
        relativePath: "body",
        content: "# Guide\n\nThis page mentions tabs in body copy only.",
      },
    ];
    const index = createDocsSearchIndex(rankingDocs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const results = searchDocs(index, "tabs");
    const headingIndex = results.findIndex(
      (result) => result.urlPath === "/docs/heading"
    );
    const bodyOnlyIndex = results.findIndex(
      (result) => result.urlPath === "/docs/body"
    );

    expect(results[0]?.title).toBe("Tabs");
    expect(headingIndex).toBeGreaterThan(-1);
    expect(bodyOnlyIndex).toBeGreaterThan(headingIndex);
  });

  it("returns no results for empty or stopword-only queries", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(searchDocs(index, "   ")).toEqual([]);
    expect(searchDocs(index, "the and or")).toEqual([]);
  });

  it("builds excerpts around matching text", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = searchDocs(index, "pnpm")[0];

    expect(result?.excerpt).toContain("pnpm");
  });

  it("builds excerpts around the match when the text has expanding characters", () => {
    // NFKD expands these (… -> ..., ™ -> TM, ½ -> 1⁄2), so an offset found in
    // the normalized text does not address the same spot in the original.
    // Kept under one chunk so every expansion accumulates ahead of the match.
    const ellipsisCountBeforeMatch = 180;
    const lead = "note… ".repeat(ellipsisCountBeforeMatch);
    const index = createDocsSearchIndex(
      [
        {
          id: "expanding",
          title: "Expanding",
          urlPath: "/docs/expanding",
          absoluteUrl: "https://leadtype.dev/docs/expanding",
          relativePath: "expanding.mdx",
          content: `# Expanding\n\n${lead}Then call hydrateWidget to finish.\n`,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "hydratewidget")[0]?.excerpt).toContain(
      "hydrateWidget"
    );
  });

  it("builds excerpts around whole-string normalized matches", () => {
    // `ΟΣ`.toLowerCase() is `ος` (final sigma); per-code-point lowercasing
    // yields `οσ`. Query tokens come from whole-string normalizeText, so the
    // excerpt window has to search that same string. Offsets still come from
    // the per-code-point map: toLowerCase is length-preserving, so the two
    // strings disagree but the original-index map does not.
    const lead = "note ".repeat(80);
    const index = createDocsSearchIndex(
      [
        {
          id: "greek",
          title: "Greek",
          urlPath: "/docs/greek",
          absoluteUrl: "https://leadtype.dev/docs/greek",
          relativePath: "greek.mdx",
          content: `# Greek\n\n${lead}ΟΣ hydrateWidget after the sigma.\n`,
        },
      ],
      { generatedAt: "2026-01-01T00:00:00.000Z" }
    );

    expect(searchDocs(index, "ος")[0]?.excerpt).toContain("ΟΣ");
  });

  it("searches metadata-only indexes and uses split content for excerpts", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createDocsSearchIndex to embed content.");
    }

    expect(searchDocs(metadataOnlyIndex, "pnpm")[0]?.title).toBe("Quickstart");
    expect(searchDocs(metadataOnlyIndex, "pnpm")[0]?.excerpt).toContain(
      "CommandTabs"
    );
    expect(
      searchDocs(metadataOnlyIndex, "pnpm", { content })[0]?.excerpt
    ).toContain("pnpm");
    expect(attachDocsSearchContent(metadataOnlyIndex, content).content).toBe(
      content
    );
  });

  it("ignores legacy split content stores missing code chunks", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createDocsSearchIndex to embed content.");
    }
    const legacyContent = JSON.parse(
      JSON.stringify({
        version: 2,
        generatedAt: index.generatedAt,
        chunks: content.chunks,
      })
    ) as DocsSearchContentStore;

    const result = searchDocs(metadataOnlyIndex, "pnpm", {
      content: legacyContent,
    })[0];

    expect(result?.title).toBe("Quickstart");
    expect(result?.excerpt).not.toContain("pnpm");
  });

  it("reads docs content as files and precise chunks", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = searchDocs(index, "pnpm")[0];
    const file = readDocsContentFile(index, "guides/quickstart");
    const fileByUrl = readDocsContentFile(index, "/docs/guides/quickstart");
    const chunk = result ? readDocsContentChunk(index, result.id) : undefined;

    expect(listDocsContentFiles(index)).toHaveLength(docs.length);
    expect(file?.title).toBe("Quickstart");
    expect(fileByUrl?.title).toBe("Quickstart");
    expect(file?.chunks[0]?.anchor).toBe("quickstart");
    expect(chunk?.absoluteUrlWithHash).toBe(
      "https://leadtype.dev/docs/guides/quickstart#commandtabs"
    );
    expect(chunk?.text).toContain("bun install commands");
  });
});

describe("createAnswerContext", () => {
  it("caps source count and total context characters", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const context = createAnswerContext(index, "tabs", {
      maxSources: 1,
      maxContextChars: 80,
      productName: "leadtype",
    });

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.context.length).toBeLessThanOrEqual(80);
  });

  it("includes citation and prompt-injection guardrails", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const context = createAnswerContext(index, "tabs", {
      productName: "leadtype",
    });

    expect(context.system).toContain(
      "Use only the provided documentation context"
    );
    expect(context.system).toContain("untrusted reference text");
    expect(context.prompt).toContain("[1]");
    expect(context.prompt).toContain("#");
  });

  it("forwards custom search synonyms into source retrieval", () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const context = createAnswerContext(index, "switcher", {
      synonyms: { switcher: ["keyboard"] },
    });

    expect(context.sources[0]?.title).toBe("Tabs");
  });
});

describe("request guards", () => {
  it("validates query shape and size", () => {
    expect(validateDocsQuery("  hello   docs  ")).toBe("hello docs");
    expect(() => validateDocsQuery("x".repeat(401))).toThrow(
      DocsSearchRequestError
    );
    expect(() => validateDocsQuery("bad\u0000query")).toThrow(
      DocsSearchRequestError
    );
  });

  it("reads JSON bodies with a byte limit", async () => {
    const request = new Request("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ query: "tabs" }),
    });

    await expect(
      readJsonWithLimit<{ query: string }>(request)
    ).resolves.toEqual({
      query: "tabs",
    });

    const oversized = new Request("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ query: "x".repeat(20) }),
    });

    await expect(readJsonWithLimit(oversized, { maxBytes: 8 })).rejects.toThrow(
      DocsSearchRequestError
    );

    const bodyless = new Request("https://example.com/api", {
      method: "POST",
    });
    await expect(
      readJsonWithLimit(bodyless, { allowEmpty: true })
    ).resolves.toBeUndefined();

    await expect(
      readJsonWithLimit(
        new Request("https://example.com/api", { method: "POST" })
      )
    ).rejects.toThrow(DocsSearchRequestError);

    const whitespace = new Request("https://example.com/api", {
      method: "POST",
      body: "  \n\t",
    });
    await expect(
      readJsonWithLimit(whitespace, { allowEmpty: true })
    ).resolves.toBeUndefined();
  });

  it("derives client identifiers from forwarding headers", () => {
    const request = new Request("https://example.com/api", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.4",
      },
    });

    expect(getClientIdentifier(request)).toBe("203.0.113.10");
  });
});

describe("createMemoryRateLimiter", () => {
  it("allows requests until the threshold and then blocks", () => {
    let now = 1000;
    const limiter = createMemoryRateLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => now,
    });

    expect(limiter.check("client").allowed).toBe(true);
    expect(limiter.check("client").allowed).toBe(true);
    expect(limiter.check("client").allowed).toBe(false);

    now = 2500;
    expect(limiter.check("client").allowed).toBe(true);
  });
});
