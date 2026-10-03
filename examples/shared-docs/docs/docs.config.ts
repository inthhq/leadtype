import { defineDocsConfig } from "leadtype";
import { regulationFlattener } from "../flatteners";

export default defineDocsConfig({
  flatteners: [regulationFlattener],
  product: {
    name: "Leadtype Dogfood",
    tagline:
      "A shared documentation fixture used by Leadtype framework examples.",
  },
  llms: {
    sections: [
      {
        type: "markdown",
        heading: "Overview",
        body: [
          "- Render one MDX source through multiple frameworks.",
          "- Serve markdown mirrors and llms.txt artifacts.",
          "- Load generated static search JSON without a database.",
        ].join("\n"),
      },
      {
        type: "links",
        heading: "Best Starting Points",
        links: [
          { urlPath: "/docs" },
          { urlPath: "/docs/quickstart" },
          { urlPath: "/docs/search" },
        ],
      },
      {
        type: "markdown",
        heading: "Agent Guidance",
        body: "Start with /docs/llms.txt, then fetch page markdown links before using /llms-full.txt.",
      },
    ],
  },
  groups: [
    {
      slug: "guide",
      title: "Guide",
      description: "The common integration path all example apps render.",
    },
    {
      slug: "reference",
      title: "Reference",
      description: "Artifact and search contracts exercised by every app.",
    },
  ],
});
