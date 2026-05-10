import { readFileSync } from "node:fs";
import { join } from "node:path";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import {
  type AgentReadabilityManifest,
  createAgentMarkdownResponse,
  type MarkdownMirrorTarget,
} from "leadtype/llm/readability";
import type { Root } from "mdast";
import { nitro } from "nitro/vite";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { defineConfig, type PluginOption, searchForWorkspaceRoot } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

function stripYamlFrontmatter() {
  return (tree: Root) => {
    if (!tree.children) {
      return tree;
    }

    tree.children = tree.children.filter((node) => node.type !== "yaml");
    return tree;
  };
}

const TEXT_CONTENT_TYPE_PATTERN = /^text\/(markdown|plain)/i;
const CHARSET_PATTERN = /charset=/i;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const DEFAULT_AGENT_BASE_URL = "https://docs.example.com";
const AGENT_READABILITY_MANIFEST_PATH = join(
  process.cwd(),
  "src",
  "generated",
  "agent-readability.json"
);
const ROOT_AGENT_ARTIFACTS = {
  "/docs/robots.txt": {
    contentType: "text/plain; charset=utf-8",
    filePath: "docs/robots.txt",
  },
  "/docs/sitemap.xml": {
    contentType: "application/xml; charset=utf-8",
    filePath: "docs/sitemap.xml",
  },
  "/robots.txt": {
    contentType: "text/plain; charset=utf-8",
    filePath: "robots.txt",
  },
  "/sitemap.xml": {
    contentType: "application/xml; charset=utf-8",
    filePath: "sitemap.xml",
  },
} as const;

function requestOrigin(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const hostHeader = req.headers["x-forwarded-host"] ?? req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host) {
    return null;
  }
  const protocolHeader = req.headers["x-forwarded-proto"];
  const protocolValue = Array.isArray(protocolHeader)
    ? protocolHeader[0]
    : protocolHeader;
  const protocol = protocolValue?.split(",")[0]?.trim() || "http";
  return `${protocol}://${host.split(",")[0]?.trim() ?? host}`;
}

function requestBaseUrl(req: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const configured =
    process.env.LEADTYPE_AGENT_BASE_URL?.trim() || process.env.BASE_URL?.trim();
  if (configured) {
    return configured.replace(TRAILING_SLASHES_PATTERN, "");
  }
  return (
    requestOrigin(req)?.replace(TRAILING_SLASHES_PATTERN, "") ??
    DEFAULT_AGENT_BASE_URL
  );
}

type SetHeader = (name: string, value: number | string | string[]) => unknown;
interface Req {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
}

interface Res {
  end: (body?: string) => void;
  setHeader: SetHeader;
  statusCode: number;
}

function readableMethod(method: string | undefined): boolean {
  return method === undefined || method === "GET" || method === "HEAD";
}

let cachedAgentReadabilityManifest: AgentReadabilityManifest | null = null;

function readAgentReadabilityManifest(): AgentReadabilityManifest {
  cachedAgentReadabilityManifest ??= JSON.parse(
    readFileSync(AGENT_READABILITY_MANIFEST_PATH, "utf8")
  ) as AgentReadabilityManifest;
  return cachedAgentReadabilityManifest;
}

function readMarkdownFile(target: MarkdownMirrorTarget): string | null {
  try {
    return readFileSync(join(process.cwd(), "public", target.filePath), "utf8");
  } catch {
    return null;
  }
}

function maybeServeMarkdown(req: Req, res: Res): boolean {
  if (!req.url) {
    return false;
  }
  const response = createAgentMarkdownResponse({
    urlPath: req.url,
    method: req.method,
    headers: req.headers,
    manifest: readAgentReadabilityManifest(),
    readMarkdownFile,
    requestOrigin: requestOrigin(req) ?? undefined,
  });
  if (!response) {
    return false;
  }
  res.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) {
    res.setHeader(name, value);
  }
  res.end(response.body);
  return true;
}

function forceUtf8OnTextResponses(res: Res) {
  const original = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (typeof name === "string" && name.toLowerCase() === "vary") {
      const values = Array.isArray(value) ? value : [String(value)];
      const hasAccept = values.some((entry) =>
        entry
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .includes("accept")
      );
      return original(name, hasAccept ? value : [...values, "Accept"]);
    }
    if (
      typeof name === "string" &&
      name.toLowerCase() === "content-type" &&
      typeof value === "string" &&
      TEXT_CONTENT_TYPE_PATTERN.test(value) &&
      !CHARSET_PATTERN.test(value)
    ) {
      return original(name, `${value}; charset=utf-8`);
    }
    return original(name, value);
  };
}

function rootAgentArtifacts(): PluginOption {
  const middleware = (req: Req, res: Res, next: () => void) => {
    if (!(readableMethod(req.method) && req.url)) {
      next();
      return;
    }
    const pathname = req.url.split("?")[0] ?? req.url;
    const artifact =
      ROOT_AGENT_ARTIFACTS[pathname as keyof typeof ROOT_AGENT_ARTIFACTS];
    if (!artifact) {
      next();
      return;
    }
    try {
      const source = readFileSync(
        join(process.cwd(), "public", artifact.filePath),
        "utf8"
      );
      const body = source.replaceAll(
        DEFAULT_AGENT_BASE_URL,
        requestBaseUrl(req)
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", artifact.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.end(req.method === "HEAD" ? "" : body);
    } catch {
      next();
    }
  };
  return {
    name: "leadtype:root-agent-artifacts",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function markdownNegotiation(): PluginOption {
  const middleware = (req: Req, res: Res, next: () => void) => {
    if (maybeServeMarkdown(req, res)) {
      return;
    }

    forceUtf8OnTextResponses(res);
    next();
  };
  return {
    name: "leadtype:markdown-negotiation",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  server: {
    allowedHosts: [".localhost"],
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  plugins: [
    rootAgentArtifacts(),
    markdownNegotiation(),
    nitro(),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    {
      ...mdx({
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [remarkFrontmatter, remarkGfm, stripYamlFrontmatter],
      }),
      enforce: "pre",
    },
    tanstackStart(),
    viteReact({
      include: /\.(mdx|[jt]sx?)$/,
    }),
  ],
});
