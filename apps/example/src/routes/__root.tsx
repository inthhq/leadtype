import { MDXProvider } from "@mdx-js/react";
import {
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { NotFound } from "@/components/not-found";
import { useMDXComponents } from "@/mdx-components";
import appCss from "../styles.css?url";

const HASH_PREFIX_PATTERN = /^#/;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "leadtype reference app",
      },
      {
        content:
          "Reference routes for MDX, components, and playground coverage.",
        name: "description",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

/**
 * Scroll to the element that matches the current URL hash whenever the hash
 * changes. TanStack Router's `scrollRestoration` handles raw scroll position
 * but doesn't handle hash anchors — so direct URL loads and programmatic
 * `navigate({ hash })` both land at the top of the page without this.
 */
function ScrollToHash() {
  const hash = useRouterState({ select: (state) => state.location.hash });
  useEffect(() => {
    if (!hash) {
      return;
    }
    const id = hash.replace(HASH_PREFIX_PATTERN, "");
    if (!id) {
      return;
    }
    // Wait two frames so the destination route has rendered before we look up
    // the element by id. Single RAF is sometimes too early on initial mount.
    let inner: number | null = null;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner !== null) {
        cancelAnimationFrame(inner);
      }
    };
  }, [hash]);
  return null;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <MDXProvider components={useMDXComponents()}>{children}</MDXProvider>
        <ScrollToHash />
        <Scripts />
      </body>
    </html>
  );
}
