import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { MDXProvider } from "@mdx-js/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

interface MdxModule {
  default: ComponentType;
}

interface Page {
  Component: ComponentType;
  category: "docs" | "changelog";
  date?: string;
  description?: string;
  filePath: string;
  label: string;
  route: string;
  source: string;
  title: string;
}

interface Heading {
  id: string;
  level: number;
  text: string;
}

interface SidebarItem {
  label: string;
  route: string;
}

interface SidebarGroup {
  items: SidebarItem[];
  title: string;
}

const mdxExtensionRegex = /\.mdx$/;
const indexRouteRegex = /\/index$/;
const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
const frontmatterFieldRegex = /^([A-Za-z0-9_-]+):\s*"?([^"]*)"?$/;
const routeDateRegex = /\/(\d{4}-\d{2}-\d{2})/;
const changelogDatePrefixRegex = /^\d{4}-\d{2}-\d{2}-/;
const trailingSlashRegex = /\/$/;
const slugCharacterRegex = /[^a-z0-9\s-]/g;
const whitespaceRegex = /\s+/g;

const docsModules = import.meta.glob<MdxModule>(
  "../../../.docs-src/c15t/docs/**/*.mdx",
  { eager: true }
);
const changelogModules = import.meta.glob<MdxModule>(
  "../../../.docs-src/c15t/changelog/**/*.mdx",
  { eager: true }
);
const docsSources = import.meta.glob<unknown>(
  "../../../.docs-src/c15t/docs/**/*.mdx",
  { eager: true, import: "default", query: "?raw" }
);
const changelogSources = import.meta.glob<unknown>(
  "../../../.docs-src/c15t/changelog/**/*.mdx",
  { eager: true, import: "default", query: "?raw" }
);

const frameworks = [
  { id: "next", label: "Next.js", shortLabel: "Next" },
  { id: "react", label: "React", shortLabel: "React" },
  { id: "javascript", label: "JavaScript", shortLabel: "JS" },
] as const;

const commonConceptItems = [
  ["concepts/initialization-flow", "Initialization Flow"],
  ["concepts/client-modes", "Client Modes"],
  ["concepts/consent-models", "Consent Models"],
  ["concepts/policy-packs", "Policy Packs"],
  ["concepts/consent-categories", "Consent Categories"],
  ["concepts/cookie-management", "Cookie Management"],
  ["concepts/glossary", "Glossary"],
] as const;

const commonGuideItems = [
  ["script-loader", "Script Loader"],
  ["iframe-blocking", "Iframe Blocking"],
  ["network-blocker", "Network Blocker"],
  ["callbacks", "Callbacks"],
  ["internationalization", "Internationalization"],
  ["policy-packs", "Policy Packs"],
] as const;

const reactFrameworkGroups = [
  {
    title: "Start",
    items: [
      ["quickstart", "Quickstart"],
      ["optimization", "Optimization"],
      ["../../ai-agents", "AI Agents"],
    ],
  },
  { title: "Concepts", items: commonConceptItems },
  {
    title: "Guides",
    items: [
      ...commonGuideItems,
      ["server-side", "Server Side"],
      ["building-headless-components", "Building Headless Components"],
      ["headless", "Headless Mode"],
    ],
  },
  {
    title: "Components",
    items: [
      ["components/consent-manager-provider", "Provider"],
      ["components/consent-banner", "Consent Banner"],
      ["components/consent-dialog", "Consent Dialog"],
      ["components/consent-widget", "Consent Widget"],
      ["components/consent-dialog-trigger", "Dialog Trigger"],
      ["components/consent-dialog-link", "Dialog Link"],
      ["components/frame", "Frame"],
      ["components/dev-tools", "DevTools"],
    ],
  },
  {
    title: "Styling",
    items: [
      ["styling/overview", "Overview"],
      ["styling/tokens", "Tokens"],
      ["styling/slots", "Slots"],
      ["styling/classnames", "Class Names"],
      ["styling/tailwind", "Tailwind"],
      ["styling/color-scheme", "Color Scheme"],
      ["styling/css-variables", "CSS Variables"],
    ],
  },
  {
    title: "Hooks",
    items: [
      ["hooks/use-consent-manager/overview", "useConsentManager"],
      ["hooks/use-translations", "useTranslations"],
      ["hooks/use-focus-trap", "useFocusTrap"],
      ["hooks/use-color-scheme", "useColorScheme"],
      ["hooks/use-reduced-motion", "useReducedMotion"],
      ["hooks/use-text-direction", "useTextDirection"],
      ["hooks/use-ssr-status", "useSSRStatus"],
      ["hooks/use-draggable", "useDraggable"],
    ],
  },
  {
    title: "IAB TCF",
    items: [
      ["iab/overview", "Overview"],
      ["iab/consent-banner", "Consent Banner"],
      ["iab/consent-dialog", "Consent Dialog"],
      ["iab/use-gvl-data", "useGVLData"],
    ],
  },
] as const;

const frameworkSidebarGroupsById = {
  next: reactFrameworkGroups,
  react: reactFrameworkGroups,
  javascript: [
    {
      title: "Start",
      items: [
        ["quickstart", "Quickstart"],
        ["optimization", "Optimization"],
        ["../../ai-agents", "AI Agents"],
      ],
    },
    { title: "Concepts", items: commonConceptItems },
    { title: "Guides", items: commonGuideItems },
    {
      title: "Store API",
      items: [
        ["api/overview", "Overview"],
        ["api/checking-consent", "Checking Consent"],
        ["api/setting-consent", "Setting Consent"],
        ["api/location-info", "Location Info"],
      ],
    },
    {
      title: "Building Framework Libraries",
      items: [["building-ui", "Building UI"]],
    },
    {
      title: "IAB TCF",
      items: [["iab/overview", "Overview"]],
    },
  ],
} as const;

const integrationsSidebarGroups = [
  {
    title: "Start",
    items: [
      { label: "Overview", route: "/docs/integrations/overview" },
      {
        label: "Building Integrations",
        route: "/docs/integrations/building-integrations",
      },
    ],
  },
  {
    title: "Tag Management",
    items: [
      {
        label: "Google Tag Manager",
        route: "/docs/integrations/google-tag-manager",
      },
      { label: "Google Tag", route: "/docs/integrations/google-tag" },
    ],
  },
  {
    title: "Measurement",
    items: [
      { label: "Databuddy", route: "/docs/integrations/databuddy" },
      { label: "PostHog", route: "/docs/integrations/posthog" },
    ],
  },
  {
    title: "Advertising",
    items: [
      { label: "Meta Pixel", route: "/docs/integrations/meta-pixel" },
      { label: "TikTok Pixel", route: "/docs/integrations/tiktok-pixel" },
      {
        label: "LinkedIn Insights",
        route: "/docs/integrations/linkedin-insights",
      },
      { label: "Microsoft UET", route: "/docs/integrations/microsoft-uet" },
      { label: "X Pixel", route: "/docs/integrations/x-pixel" },
    ],
  },
] satisfies SidebarGroup[];

const selfHostSidebarGroups = [
  {
    title: "Start",
    items: [{ label: "Quickstart", route: "/docs/self-host/quickstart" }],
  },
  {
    title: "Guides",
    items: [
      {
        label: "Database Setup",
        route: "/docs/self-host/guides/database-setup",
      },
      {
        label: "Framework Integration",
        route: "/docs/self-host/guides/framework-integration",
      },
      {
        label: "Edge Deployment",
        route: "/docs/self-host/guides/edge-deployment",
      },
      { label: "Caching", route: "/docs/self-host/guides/caching" },
      { label: "IAB TCF", route: "/docs/self-host/guides/iab-tcf" },
      { label: "Policy Packs", route: "/docs/self-host/guides/policy-packs" },
      { label: "Observability", route: "/docs/self-host/guides/observability" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { label: "Endpoints", route: "/docs/self-host/api/endpoints" },
      { label: "Configuration", route: "/docs/self-host/api/configuration" },
    ],
  },
] satisfies SidebarGroup[];

const topNavItems = [
  { label: "Frontend", route: "/docs/frameworks/next/quickstart" },
  { label: "Integrations", route: "/docs/integrations/overview" },
  { label: "Self Host", route: "/docs/self-host/quickstart" },
] as const;

const routeFromPath = (filePath: string, category: Page["category"]) => {
  const sourcePrefix =
    category === "docs"
      ? "../../../.docs-src/c15t/docs/"
      : "../../../.docs-src/c15t/changelog/";
  const relativePath = filePath
    .replace(sourcePrefix, "")
    .replace(mdxExtensionRegex, "")
    .replace(indexRouteRegex, "");
  const prefix = category === "docs" ? "/docs" : "/changelog";
  return `${prefix}${relativePath ? `/${relativePath}` : ""}`;
};

const titleFromSlug = (route: string) => {
  const slug = route.split("/").filter(Boolean).at(-1) ?? "docs";
  return slug
    .split("-")
    .map((part) => {
      const firstLetter = part.charAt(0).toUpperCase();
      return part.length <= 3
        ? part.toUpperCase()
        : `${firstLetter}${part.slice(1)}`;
    })
    .join(" ");
};

const titleFromChangelogRoute = (route: string) =>
  route
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(changelogDatePrefixRegex, "") ?? titleFromSlug(route);

const parseFrontmatter = (source: string) => {
  const match = source.match(frontmatterRegex);
  if (!match) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const field = line.match(frontmatterFieldRegex);
    if (field?.[1] && field[2]) {
      fields[field[1]] = field[2].trim();
    }
  }
  return fields;
};

const createPages = (
  modules: Record<string, MdxModule>,
  sources: Record<string, unknown>,
  category: Page["category"]
) =>
  Object.entries(modules).map(([filePath, module]) => {
    const rawSource = sources[filePath];
    const source = typeof rawSource === "string" ? rawSource : "";
    const frontmatter = parseFrontmatter(source);
    const route = routeFromPath(filePath, category);
    const title =
      frontmatter.title ||
      (category === "changelog"
        ? titleFromChangelogRoute(route)
        : titleFromSlug(route));
    return {
      category,
      date: frontmatter.date || route.match(routeDateRegex)?.[1],
      description: frontmatter.description,
      filePath,
      label: title,
      route,
      source,
      title,
      Component: module.default,
    } satisfies Page;
  });

const pages = [
  ...createPages(docsModules, docsSources, "docs"),
  ...createPages(changelogModules, changelogSources, "changelog"),
].sort((left, right) => left.route.localeCompare(right.route));

const pagesByRoute = new Map(pages.map((page) => [page.route, page]));
const changelogPages = pages
  .filter((page) => page.category === "changelog")
  .sort((left, right) => right.route.localeCompare(left.route));
const defaultRoute = "/docs/frameworks/next/quickstart";
const changelogRoute = changelogPages[0]?.route ?? "/changelog";

const normalizePath = (path: string) => {
  if (path === "/" || path === "") {
    return defaultRoute;
  }
  return path.replace(trailingSlashRegex, "");
};

const navigateTo = (route: string) => {
  const normalizedRoute = normalizePath(route);
  window.history.pushState({}, "", normalizedRoute);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

const getFramework = (route: string) =>
  frameworks.find((framework) =>
    route.startsWith(`/docs/frameworks/${framework.id}/`)
  );

const getFrameworkRoute = (currentRoute: string, nextFramework: string) => {
  const currentFramework = getFramework(currentRoute);
  const suffix = currentFramework
    ? currentRoute.replace(`/docs/frameworks/${currentFramework.id}/`, "")
    : "quickstart";
  const preferredRoute = `/docs/frameworks/${nextFramework}/${suffix}`;
  return pagesByRoute.has(preferredRoute)
    ? preferredRoute
    : `/docs/frameworks/${nextFramework}/quickstart`;
};

const filterExistingGroups = (groups: SidebarGroup[]) =>
  groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => pagesByRoute.has(item.route)),
    }))
    .filter((group) => group.items.length > 0);

const getFrameworkSidebarGroups = (frameworkId: string) =>
  filterExistingGroups(
    frameworkSidebarGroupsById[
      frameworkId as keyof typeof frameworkSidebarGroupsById
    ].map((group, index) => ({
      title:
        index === 0
          ? (frameworks.find((framework) => framework.id === frameworkId)
              ?.label ?? group.title)
          : group.title,
      items: group.items.map(([suffix, label]) => {
        const isSharedPage = suffix.startsWith("../");
        return {
          label,
          route: isSharedPage
            ? `/docs/${suffix.replace(/^\.\.\//g, "")}`
            : `/docs/frameworks/${frameworkId}/${suffix}`,
        };
      }),
    }))
  );

const getChangelogSidebarGroups = () => [
  {
    title: "Releases",
    items: changelogPages.map((page) => ({
      label: page.label,
      route: page.route,
    })),
  },
];

const getFallbackSidebarGroups = () => [
  {
    title: "Docs",
    items: [
      { label: "Frameworks", route: "/docs/frameworks" },
      { label: "AI Agents", route: "/docs/ai-agents" },
      { label: "CLI", route: "/docs/cli/overview" },
      { label: "Open Source", route: "/docs/oss/why-open-source" },
    ],
  },
];

const getSidebarConfig = (route: string) => {
  const currentFramework = getFramework(route);
  if (currentFramework) {
    return {
      description: "Frontend docs",
      groups: getFrameworkSidebarGroups(currentFramework.id),
      title: "Select a framework",
      type: "framework",
    };
  }

  if (route.startsWith("/docs/integrations")) {
    return {
      description: "Scripts, analytics, and ad platform helpers",
      groups: filterExistingGroups(integrationsSidebarGroups),
      title: "Integrations",
      type: "section",
    };
  }

  if (route.startsWith("/docs/self-host")) {
    return {
      description: "Backend setup, deployment, and API reference",
      groups: filterExistingGroups(selfHostSidebarGroups),
      title: "Self-Hosting",
      type: "section",
    };
  }

  if (route.startsWith("/changelog")) {
    return {
      description: "Release notes and product updates",
      groups: getChangelogSidebarGroups(),
      title: "Changelog",
      type: "section",
    };
  }

  return {
    description: "Project documentation",
    groups: filterExistingGroups(getFallbackSidebarGroups()),
    title: "Documentation",
    type: "section",
  };
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(slugCharacterRegex, "")
    .trim()
    .replace(whitespaceRegex, "-");

const collectHeadings = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".doc-content h2, .doc-content h3")
  )
    .map((element) => {
      if (!element.id) {
        element.id = slugify(element.textContent ?? "");
      }
      return {
        id: element.id,
        level: Number(element.tagName.slice(1)),
        text: element.textContent ?? "",
      };
    })
    .filter((heading) => heading.id && heading.text);

const formatDate = (date?: string) => {
  if (!date) {
    return;
  }
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const markdownHref = (route: string) =>
  `${route === "/docs" || route === "/changelog" ? `${route}/index` : route}.md`;

const ShellLink = ({ children, className, href = "" }: ComponentProps<"a">) => {
  const isInternal = href.startsWith("/");
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (!isInternal) {
          return;
        }
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
};

const getIconLabel = (name?: string) => {
  if (name === "react") {
    return "R";
  }
  if (name === "javascript") {
    return "JS";
  }
  if (name === "nextjs") {
    return "N";
  }
  return "#";
};

const Icon = ({ name }: { name?: string }) => (
  <span aria-hidden="true" className={`doc-icon doc-icon-${name ?? "default"}`}>
    {getIconLabel(name)}
  </span>
);

const Callout = ({
  children,
  title,
  type = "info",
}: {
  children: ReactNode;
  title?: string;
  type?: string;
}) => (
  <aside className={`callout callout-${type}`}>
    {title ? <strong>{title}</strong> : null}
    <div>{children}</div>
  </aside>
);

const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="steps">{children}</ol>
);

const Step = ({ children }: { children: ReactNode }) => (
  <li className="step">{children}</li>
);

const Cards = ({ children }: { children: ReactNode }) => (
  <div className="cards">{children}</div>
);

const Card = ({
  children,
  description,
  href,
  icon,
  title,
}: {
  children?: ReactNode;
  description?: string;
  href?: string;
  icon?: ReactNode;
  title?: string;
}) => {
  const content = (
    <>
      <span className="card-icon">{icon}</span>
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
      {children}
    </>
  );

  if (href) {
    return (
      <ShellLink className="doc-card" href={href}>
        {content}
      </ShellLink>
    );
  }

  return <div className="doc-card">{content}</div>;
};

const PackageCommandTabs = ({
  command,
  mode,
}: {
  command: string;
  mode?: "install" | "run";
}) => {
  const commands =
    mode === "install"
      ? [
          ["npm", `npm install ${command}`],
          ["pnpm", `pnpm add ${command}`],
          ["yarn", `yarn add ${command}`],
          ["bun", `bun add ${command}`],
        ]
      : [
          ["npm", `npx ${command}`],
          ["pnpm", `pnpm dlx ${command}`],
          ["yarn", `yarn dlx ${command}`],
          ["bun", `bunx ${command}`],
        ];

  return (
    <div className="command-tabs">
      <div className="command-tabs-list">
        {commands.map(([manager]) => (
          <button key={manager} type="button">
            {manager}
          </button>
        ))}
      </div>
      <pre>
        <code>{commands[0]?.[1]}</code>
      </pre>
    </div>
  );
};

const Tabs = ({
  children,
  items,
}: {
  children: ReactNode;
  items?: string[];
}) => (
  <div className="inline-tabs">
    {items ? (
      <div className="inline-tab-list">
        {items.map((item) => (
          <button key={item} type="button">
            {item}
          </button>
        ))}
      </div>
    ) : null}
    {children}
  </div>
);

const Tab = ({ children, value }: { children: ReactNode; value?: string }) => (
  <section className="inline-tab-panel">
    {value ? <strong>{value}</strong> : null}
    {children}
  </section>
);

const Accordion = ({ children }: { children: ReactNode }) => (
  <div className="accordion">{children}</div>
);

const AccordionItem = ({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) => (
  <details className="accordion-item" open>
    <summary>{title ?? "Details"}</summary>
    {children}
  </details>
);

const AutoTypeTable = ({ name, path }: { name?: string; path?: string }) => (
  <div className="type-placeholder">
    <strong>{name ?? "Type"}</strong>
    {path ? <code>{path}</code> : null}
  </div>
);

const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;

const mdxComponents = {
  a: ShellLink,
  Accordion,
  AccordionItem,
  AutoTypeTable,
  C15tPrefetch: Passthrough,
  Callout,
  Card,
  Cards,
  ConsentBanner: Passthrough,
  ConsentButton: Passthrough,
  ConsentDialog: Passthrough,
  ConsentDialogLink: Passthrough,
  ConsentDialogTrigger: Passthrough,
  ConsentManager: Passthrough,
  ConsentManagerDialog: Passthrough,
  ConsentManagerProvider: Passthrough,
  ConsentManagerWidget: Passthrough,
  ConsentWidget: Passthrough,
  ContributorBlock: Passthrough,
  CookieBanner: Passthrough,
  CustomConsentBanner: Passthrough,
  Details: AccordionItem,
  DevTools: Passthrough,
  File: Passthrough,
  FileTree: Passthrough,
  Folder: Passthrough,
  Frame: Passthrough,
  IABConsentBanner: Passthrough,
  IABConsentDialog: Passthrough,
  Icon,
  InteractiveWidget: Passthrough,
  MyComponent: Passthrough,
  PackageCommandTabs,
  Step,
  Steps,
  Tab,
  Tabs,
  TanStackDevtools: Passthrough,
  TypeTable: AutoTypeTable,
  import: Passthrough,
};

const Sidebar = ({ route }: { route: string }) => {
  const currentFramework = getFramework(route) ?? frameworks[0];
  const sidebarConfig = getSidebarConfig(route);
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="inth">
          IN
          <br />
          TH
        </span>
        <span className="divider">/</span>
        <span className="network">c15t</span>
      </div>

      {sidebarConfig.type === "framework" ? (
        <div className="framework-select">
          <span>{sidebarConfig.title}</span>
          <div>
            {frameworks.map((framework) => (
              <button
                aria-pressed={framework.id === currentFramework.id}
                key={framework.id}
                onClick={() =>
                  navigateTo(getFrameworkRoute(route, framework.id))
                }
                type="button"
              >
                <Icon
                  name={framework.id === "next" ? "nextjs" : framework.id}
                />
                {framework.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="section-context">
          <span>{sidebarConfig.title}</span>
          <p>{sidebarConfig.description}</p>
        </div>
      )}

      <nav className="side-nav">
        {sidebarConfig.groups.map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            {group.items.map((item) => (
              <ShellLink
                className={item.route === route ? "active" : undefined}
                href={item.route}
                key={item.route}
              >
                {item.label}
              </ShellLink>
            ))}
          </section>
        ))}
      </nav>
    </aside>
  );
};

const TopNav = ({ route }: { route: string }) => (
  <header className="top-nav">
    <nav>
      {topNavItems.map((item) => (
        <ShellLink
          className={
            route.startsWith(item.route.split("/").slice(0, 3).join("/"))
              ? "active"
              : undefined
          }
          href={item.route}
          key={item.route}
        >
          {item.label}
        </ShellLink>
      ))}
      <ShellLink
        className={route.startsWith("/changelog") ? "active" : undefined}
        href={changelogRoute}
      >
        Changelog
      </ShellLink>
    </nav>
  </header>
);

const RightRail = ({
  headings,
  route,
}: {
  headings: Heading[];
  route: string;
}) => (
  <aside className="right-rail">
    <a className="copy-markdown" href={markdownHref(route)}>
      Copy Markdown
    </a>

    {getFramework(route) ? (
      <div className="framework-pills">
        {frameworks.map((framework) => (
          <button
            aria-pressed={route.includes(`/frameworks/${framework.id}/`)}
            key={framework.id}
            onClick={() => navigateTo(getFrameworkRoute(route, framework.id))}
            type="button"
          >
            {framework.shortLabel}
          </button>
        ))}
      </div>
    ) : null}

    <nav className="toc">
      <h2>On this page</h2>
      {headings.length === 0 ? (
        <span>No headings</span>
      ) : (
        headings.map((heading) => (
          <a
            className={heading.level === 3 ? "toc-nested" : undefined}
            href={`#${heading.id}`}
            key={heading.id}
          >
            {heading.text}
          </a>
        ))
      )}
    </nav>
  </aside>
);

export const App = () => {
  const [route, setRoute] = useState(() =>
    normalizePath(window.location.pathname)
  );
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    const onPopState = () => setRoute(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const page = pagesByRoute.get(route);
  const content = useMemo(() => {
    if (!page) {
      return null;
    }
    return <page.Component />;
  }, [page]);

  useEffect(() => {
    if (!page?.route) {
      return;
    }
    const frame = window.requestAnimationFrame(() =>
      setHeadings(collectHeadings())
    );
    return () => window.cancelAnimationFrame(frame);
  }, [page?.route]);

  if (!page) {
    return (
      <div className="app-shell">
        <Sidebar route={route} />
        <main className="not-found">
          <h1>Page not found</h1>
          <ShellLink href={defaultRoute}>Return to quickstart</ShellLink>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar route={route} />
      <div className="content-shell">
        <TopNav route={route} />
        <main className="doc-layout">
          <article className="doc-article">
            <header className="doc-header">
              <span>
                {page.category === "changelog" ? "Changelog" : "Documentation"}
              </span>
              <h1>{page.title}</h1>
              {page.date ? <p>Last updated {formatDate(page.date)}</p> : null}
              {page.description ? <p>{page.description}</p> : null}
            </header>
            <MDXProvider components={mdxComponents}>
              <div className="doc-content">{content}</div>
            </MDXProvider>
          </article>
          <RightRail headings={headings} route={route} />
        </main>
      </div>
    </div>
  );
};
