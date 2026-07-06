import { MDXProvider } from "@mdx-js/react";
import {
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useLeadtypeWebMcp } from "leadtype/webmcp/react";
import { type ReactNode, useEffect } from "react";
import { NotFound } from "@/components/not-found";
import { siteJsonLdScript } from "@/lib/docs-head";
import { useMDXComponents } from "@/mdx-components";
import appCss from "../styles.css?url";

const HASH_PREFIX_PATTERN = /^#/;
const DOCS_ANCHOR_OFFSET_PROPERTY = "--docs-anchor-offset-rem";
const FALLBACK_HASH_SCROLL_OFFSET_PX = 84;

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
    // Site-level JSON-LD graph, emitted once; per-page TechArticle @ids resolve to it.
    scripts: [siteJsonLdScript()],
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
  const location = useRouterState({
    select: (state) => ({
      hash: state.location.hash,
      pathname: state.location.pathname,
    }),
  });
  useEffect(() => {
    const { hash } = location;
    if (!hash) {
      return;
    }
    const id = decodeURIComponent(hash.replace(HASH_PREFIX_PATTERN, ""));
    if (!id) {
      return;
    }
    const scrollToElement = () => {
      const element = document.getElementById(id);
      if (!element) {
        return;
      }
      const targetTop =
        element.getBoundingClientRect().top +
        window.scrollY -
        getHashScrollOffsetPx();
      window.scrollTo({ behavior: "auto", top: Math.max(targetTop, 0) });
    };
    // Wait two frames so the destination route has rendered before we look up
    // the element by id. Single RAF is sometimes too early on initial mount.
    let timeout: number | null = null;
    let inner: number | null = null;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        scrollToElement();
        timeout = window.setTimeout(scrollToElement, 100);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner !== null) {
        cancelAnimationFrame(inner);
      }
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [location]);
  return null;
}

function getHashScrollOffsetPx(): number {
  const rootStyle = getComputedStyle(document.documentElement);
  const offsetRem = Number.parseFloat(
    rootStyle.getPropertyValue(DOCS_ANCHOR_OFFSET_PROPERTY)
  );
  const rootFontSizePx = Number.parseFloat(rootStyle.fontSize);

  if (Number.isFinite(offsetRem) && Number.isFinite(rootFontSizePx)) {
    return offsetRem * rootFontSizePx;
  }

  return FALLBACK_HASH_SCROLL_OFFSET_PX;
}

function LeadtypeWebMcp() {
  useLeadtypeWebMcp();
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
        <LeadtypeWebMcp />
        <ScrollToHash />
        <Scripts />
      </body>
    </html>
  );
}
