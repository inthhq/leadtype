import { MDXProvider } from "@mdx-js/react";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMDXComponents } from "@/mdx-components";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "@inth/docs reference app",
      },
      {
        content:
          "Reference routes for MDX, components, and playground coverage.",
        name: "description",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <MDXProvider components={useMDXComponents()}>{children}</MDXProvider>
        <Scripts />
      </body>
    </html>
  );
}
