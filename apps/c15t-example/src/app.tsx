import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import type {
  AgentReadabilityManifest,
  AgentReadabilityPage,
} from "leadtype/llm/readability";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import {
  createDocsNavigation,
  type DocsAdjacentPages,
  type DocsBreadcrumb,
  type DocsHeaderTab,
  type DocsNavigationApi,
  type DocsSidebarSection,
} from "leadtype/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";

type AppStatus = "loading" | "ready" | "error";

type DocsState =
  | { status: "loading" }
  | {
      error: string;
      status: "error";
    }
  | {
      manifest: AgentReadabilityManifest;
      navigation: DocsNavigationApi;
      status: "ready";
    };

type MarkdownState =
  | { status: "loading" }
  | {
      content: string;
      status: "ready";
    }
  | {
      error: string;
      status: "error";
    };

const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
const fencedCodeBlockRegex = /^```[\s\S]*?^```$/gm;
const headingRegex = /^#{2,3}\s+(.+)$/gm;
const markdownExtensionRegex = /\.md$/;
const trailingSlashRegex = /\/$/;

function normalizeRoute(pathname: string) {
  if (pathname === "/" || pathname === "") {
    return "/docs";
  }
  return pathname.length > 1
    ? pathname.replace(trailingSlashRegex, "")
    : pathname;
}

function markdownPathForPage(page: AgentReadabilityPage) {
  return `/docs/${page.relativePath}.md`;
}

function pagePathFromMarkdown(markdownPath: string) {
  return markdownPath.replace(markdownExtensionRegex, "");
}

function stripFrontmatter(markdown: string) {
  return markdown.replace(frontmatterRegex, "");
}

function stripFencedCodeBlocks(markdown: string) {
  return markdown.replace(fencedCodeBlockRegex, "");
}

function extractHeadings(markdown: string) {
  const markdownWithoutCode = stripFencedCodeBlocks(markdown);
  return Array.from(markdownWithoutCode.matchAll(headingRegex)).map((match) => {
    const text = match[1]?.replace(/`/g, "") ?? "";
    const level = match[0].startsWith("###") ? 3 : 2;
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    return { id, level, text };
  });
}

function withOccurrenceKeys<T>(
  items: T[],
  getBaseKey: (item: T) => string
): Array<{ item: T; key: string }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const baseKey = getBaseKey(item);
    const occurrence = seen.get(baseKey) ?? 0;
    seen.set(baseKey, occurrence + 1);
    return {
      item,
      key: occurrence === 0 ? baseKey : `${baseKey}-${occurrence}`,
    };
  });
}

function useCurrentRoute() {
  const [route, setRoute] = useState(() => normalizeRoute(location.pathname));

  useEffect(() => {
    function handlePopState() {
      setRoute(normalizeRoute(location.pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return {
    route,
    setRoute(to: string) {
      const normalized = normalizeRoute(to);
      if (normalized !== normalizeRoute(location.pathname)) {
        history.pushState(null, "", normalized);
      }
      setRoute(normalized);
      window.scrollTo({ top: 0 });
    },
  };
}

function useDocsState() {
  const [state, setState] = useState<DocsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadManifest() {
      const response = await fetch("/docs/agent-readability.json");
      if (!response.ok) {
        throw new Error(`Manifest request failed with ${response.status}`);
      }
      const manifest = normalizeAgentReadabilityManifest(await response.json());
      if (!cancelled) {
        setState({
          manifest,
          navigation: createDocsNavigation(manifest.navigation),
          status: "ready",
        });
      }
    }

    loadManifest().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          error:
            error instanceof Error
              ? error.message
              : "Unable to load c15t docs manifest.",
          status: "error",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function useMarkdown(page: AgentReadabilityPage | undefined) {
  const [state, setState] = useState<MarkdownState>({ status: "loading" });

  useEffect(() => {
    if (!page) {
      return;
    }

    const markdownPath = markdownPathForPage(page);
    let cancelled = false;
    setState({ status: "loading" });

    async function loadMarkdown() {
      const response = await fetch(markdownPath);
      if (!response.ok) {
        throw new Error(`Markdown request failed with ${response.status}`);
      }
      const markdown = stripFrontmatter(await response.text());
      if (!cancelled) {
        setState({ content: markdown, status: "ready" });
      }
    }

    loadMarkdown().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          error:
            error instanceof Error
              ? error.message
              : "Unable to load generated markdown.",
          status: "error",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  return state;
}

function Link({
  children,
  className,
  isActive = false,
  onNavigate,
  to,
}: {
  children: ReactNode;
  className?: string;
  isActive?: boolean;
  onNavigate: (to: string) => void;
  to: string;
}) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      className={className}
      href={to}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

function Brand() {
  return (
    <a className="brand" href="/docs">
      <span className="mark">c</span>
      <span>
        <strong>c15t</strong>
        <small>Docs repro</small>
      </span>
    </a>
  );
}

function Sidebar({
  activePath,
  onNavigate,
  sections,
}: {
  activePath: string;
  onNavigate: (to: string) => void;
  sections: DocsSidebarSection[];
}) {
  return (
    <aside className="sidebar">
      <Brand />
      <div className="section-context">
        <span>Generated docs</span>
        <p>
          This Vite app reads the markdown, navigation, and agent manifest that
          Leadtype generated from the real c15t docs repo.
        </p>
      </div>
      <nav aria-label="Docs sections" className="side-nav">
        {withOccurrenceKeys(sections, (section) => section.title).map(
          ({ item: section, key }) => (
            <section key={key}>
              <h2>{section.title}</h2>
              {withOccurrenceKeys(
                section.links,
                (item) => `${item.to}-${item.label}`
              ).map(({ item, key }) => (
                <Link
                  className={item.to === activePath ? "active" : undefined}
                  isActive={item.to === activePath}
                  key={key}
                  onNavigate={onNavigate}
                  to={item.to}
                >
                  {item.label}
                </Link>
              ))}
            </section>
          )
        )}
      </nav>
    </aside>
  );
}

function TopNav({
  activePath,
  onNavigate,
  tabs,
}: {
  activePath: string;
  onNavigate: (to: string) => void;
  tabs: DocsHeaderTab[];
}) {
  return (
    <header className="top-nav">
      <nav aria-label="Primary docs groups">
        {withOccurrenceKeys(
          tabs,
          (tab) => `${tab.groupKey ?? tab.to}-${tab.to}`
        ).map(({ item: tab, key }) => (
          <Link
            className={activePath.startsWith(tab.to) ? "active" : undefined}
            isActive={activePath.startsWith(tab.to)}
            key={key}
            onNavigate={onNavigate}
            to={tab.to}
          >
            {tab.label}
          </Link>
        ))}
        <a href="/llms.txt">llms.txt</a>
        <a href="/docs/agent-readability.json">agent manifest</a>
      </nav>
    </header>
  );
}

function Breadcrumbs({
  breadcrumbs,
  onNavigate,
}: {
  breadcrumbs: DocsBreadcrumb[];
  onNavigate: (to: string) => void;
}) {
  if (breadcrumbs.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {withOccurrenceKeys(
        breadcrumbs,
        (crumb) => `${crumb.to}-${crumb.label}`
      ).map(({ item: crumb, key }, index) => (
        <span key={key}>
          {index > 0 ? <span aria-hidden="true">/</span> : null}
          <Link onNavigate={onNavigate} to={crumb.to}>
            {crumb.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

function RightRail({
  markdownPath,
  headings,
}: {
  headings: ReturnType<typeof extractHeadings>;
  markdownPath: string;
}) {
  return (
    <aside className="right-rail">
      <a className="copy-markdown" href={markdownPath}>
        Open markdown mirror
      </a>
      <nav aria-label="On this page" className="toc">
        <h2>On this page</h2>
        {headings.length > 0 ? (
          withOccurrenceKeys(
            headings,
            (heading) => `${heading.id}-${heading.text}`
          ).map(({ item: heading, key }) => (
            <a
              className={heading.level === 3 ? "toc-nested" : undefined}
              href={`#${heading.id}`}
              key={key}
            >
              {heading.text}
            </a>
          ))
        ) : (
          <span>No headings found</span>
        )}
      </nav>
    </aside>
  );
}

function AdjacentLinks({
  adjacent,
  onNavigate,
}: {
  adjacent: DocsAdjacentPages;
  onNavigate: (to: string) => void;
}) {
  if (!(adjacent.previous || adjacent.next)) {
    return null;
  }

  return (
    <nav aria-label="Previous and next pages" className="adjacent-links">
      {adjacent.previous ? (
        <Link onNavigate={onNavigate} to={adjacent.previous.urlPath}>
          <span>Previous</span>
          {adjacent.previous.title}
        </Link>
      ) : (
        <span />
      )}
      {adjacent.next ? (
        <Link onNavigate={onNavigate} to={adjacent.next.urlPath}>
          <span>Next</span>
          {adjacent.next.title}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function LoadingState({ status }: { status: AppStatus }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
      </aside>
      <main className="not-found">
        <p>{status === "loading" ? "Loading c15t docs..." : "Not found"}</p>
      </main>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
      </aside>
      <main className="not-found">
        <h1>Docs artifact error</h1>
        <p>{message}</p>
      </main>
    </div>
  );
}

export function App() {
  const docs = useDocsState();
  const { route, setRoute } = useCurrentRoute();

  const activePage = useMemo(() => {
    if (docs.status !== "ready") {
      return;
    }
    return (
      docs.manifest.pages.find((page) => page.urlPath === route) ??
      docs.manifest.pages.find(
        (page) => pagePathFromMarkdown(markdownPathForPage(page)) === route
      ) ??
      docs.manifest.pages[0]
    );
  }, [docs, route]);

  const markdown = useMarkdown(activePage);

  const visibleRoute = activePage?.urlPath ?? route;
  const sections =
    docs.status === "ready"
      ? docs.navigation.getSidebarSections(visibleRoute)
      : [];
  const tabs = docs.status === "ready" ? docs.navigation.getHeaderTabs() : [];
  const breadcrumbs =
    docs.status === "ready" ? docs.navigation.getBreadcrumbs(visibleRoute) : [];
  const adjacent =
    docs.status === "ready"
      ? docs.navigation.getAdjacentPages(visibleRoute)
      : { next: null, previous: null };
  const markdownPath = activePage
    ? markdownPathForPage(activePage)
    : "/llms.txt";
  const headings =
    markdown.status === "ready" ? extractHeadings(markdown.content) : [];

  if (docs.status === "loading") {
    return <LoadingState status="loading" />;
  }

  if (docs.status === "error") {
    return <ErrorState message={docs.error} />;
  }

  if (!activePage) {
    return <LoadingState status="ready" />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        activePath={visibleRoute}
        onNavigate={setRoute}
        sections={sections}
      />
      <div className="content-shell">
        <TopNav activePath={visibleRoute} onNavigate={setRoute} tabs={tabs} />
        <div className="doc-layout">
          <main className="doc-article">
            <Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={setRoute} />
            <header className="doc-header">
              <span>c15t docs</span>
              <h1>{activePage.title}</h1>
              {activePage.description ? <p>{activePage.description}</p> : null}
            </header>
            <article className="doc-content">
              {markdown.status === "loading" ? (
                <p>Loading generated markdown...</p>
              ) : null}
              {markdown.status === "error" ? <p>{markdown.error}</p> : null}
              {markdown.status === "ready" ? (
                <Streamdown>{markdown.content}</Streamdown>
              ) : null}
            </article>
            <AdjacentLinks adjacent={adjacent} onNavigate={setRoute} />
          </main>
          <RightRail headings={headings} markdownPath={markdownPath} />
        </div>
      </div>
    </div>
  );
}
