import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { lintDocs } from "../lint/runner";
import {
  type AgentReadabilityManifest,
  normalizeAgentReadabilityManifest,
} from "../llm/readability";

/**
 * One checked signal within a dimension. `points`/`max` are whole numbers; a
 * passed signal earns `max`, a failed one earns 0 (or a partial for coverage
 * signals). `fix` is the actionable next step when `points < max`.
 */
export type ScoreSignal = {
  id: string;
  label: string;
  points: number;
  max: number;
  fix?: string;
};

export type ScoreDimension = {
  id: string;
  label: string;
  /** Whether leadtype can move this dimension. Out-of-lane dims aren't scored. */
  inLane: boolean;
  points: number;
  max: number;
  signals: ScoreSignal[];
  /** For out-of-lane dimensions: why it's excluded + where it actually lives. */
  note?: string;
};

export type ScoreResult = {
  /** 0–100 over the leadtype-addressable dimensions (Identity + Integration). */
  score: number;
  dimensions: ScoreDimension[];
  /** Actionable fixes, highest-value first. */
  fixes: string[];
};

export type ScoreDocsConfig = {
  /** Generated output root (where `generate` wrote artifacts). Default `./public`. */
  outDir?: string;
  /** Docs source root, for the structural GEO check. Default `./docs`. */
  srcDir?: string;
};

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function signal(
  id: string,
  label: string,
  ok: boolean,
  max: number,
  fix: string
): ScoreSignal {
  return { id, label, points: ok ? max : 0, max, ...(ok ? {} : { fix }) };
}

function descriptionFix(
  totalPages: number,
  describedPages: number
): { fix?: string } {
  if (totalPages === 0) {
    return { fix: "No manifest found — run `leadtype generate` first." };
  }
  if (describedPages < totalPages) {
    return {
      fix: `${totalPages - describedPages} page(s) have no description — add one (it feeds llms.txt, JSON-LD, and meta).`,
    };
  }
  return {};
}

function dimensionPoints(signals: ScoreSignal[]): {
  points: number;
  max: number;
} {
  return signals.reduce(
    (acc, s) => ({ points: acc.points + s.points, max: acc.max + s.max }),
    { points: 0, max: 0 }
  );
}

const OUT_OF_LANE: { id: string; label: string; note: string }[] = [
  {
    id: "discovery",
    label: "Discovery",
    note: "Answer-engine recall (does the model know you by name) is brand/training-data — not something a docs pipeline emits.",
  },
  {
    id: "auth",
    label: "Auth & Access",
    note: "OpenAPI, OAuth, and scoped permissions live in your product's backend, not its docs.",
  },
  {
    id: "ux",
    label: "User Experience",
    note: "MCP Apps (ui:// resources) need rendered UI; leadtype ships no UI components.",
  },
];

/**
 * Scores the leadtype-addressable agent-readiness of a generated docs build,
 * mapped to the ora rubric so users can coach toward a high external scan
 * (https://ora.ai/score). It scores **what leadtype emits + your doc structure** —
 * a local proxy for the external scan, never live answer-engine ranking. Dimensions
 * leadtype can't move (Discovery, Auth, UX) are listed with a pointer, not scored.
 */
export async function scoreDocs(
  config: ScoreDocsConfig = {}
): Promise<ScoreResult> {
  const outDir = path.resolve(config.outDir ?? "./public");
  const srcDir = path.resolve(config.srcDir ?? "./docs");
  const docsDir = path.join(outDir, "docs");

  const has = (...segments: string[]) =>
    existsSync(path.join(outDir, ...segments));

  const manifest = await readJson<unknown>(
    path.join(docsDir, "agent-readability.json")
  );
  const normalizedManifest: AgentReadabilityManifest | null = manifest
    ? normalizeAgentReadabilityManifest(manifest)
    : null;
  const pages = normalizedManifest?.pages ?? [];
  const robotsTxt = await readFile(
    path.join(docsDir, "robots.txt"),
    "utf8"
  ).catch(() => "");

  const hasIndex = has("docs", "search-index.json");
  const hasManifest = Boolean(normalizedManifest);
  // JSON-LD is host-rendered from the manifest; "ready" = the fields renderJsonLd
  // needs are present on every page.
  const jsonLdReady =
    pages.length > 0 &&
    pages.every((p) => p.title && p.description && p.lastModified);
  const describedPages = pages.filter((p) => p.description?.trim()).length;
  const descriptionCoverage =
    pages.length > 0 ? describedPages / pages.length : 0;

  // Structural GEO: reuse the lint geo:* rules over the source.
  let geoClean = true;
  if (existsSync(srcDir)) {
    const lint = await lintDocs({ srcDir });
    geoClean = !lint.violations.some((vio) => vio.rule.startsWith("geo:"));
  }

  const identitySignals: ScoreSignal[] = [
    signal(
      "llms-txt",
      "llms.txt",
      has("llms.txt"),
      2,
      "Run `leadtype generate` (site mode) to emit llms.txt."
    ),
    signal(
      "llms-full",
      "llms-full.txt",
      has("llms-full.txt"),
      1,
      "Emit the full-context fallback with `leadtype generate`."
    ),
    signal(
      "well-known",
      ".well-known/llms.txt discovery",
      has(".well-known", "llms.txt"),
      1,
      "Regenerate — the well-known copy ships with site-mode `generate`."
    ),
    signal(
      "search-manifest",
      "search index + readability manifest",
      hasIndex && hasManifest,
      2,
      "Run `leadtype generate` to emit search-index.json + agent-readability.json."
    ),
    // robots/sitemap may be served dynamically (regenerated per-request with the
    // live origin) rather than left as static files — a present manifest proves
    // `generate` produced them, so accept either.
    signal(
      "sitemap",
      "sitemap.xml",
      has("docs", "sitemap.xml") || hasManifest,
      1,
      "Emit the sitemap with `leadtype generate`."
    ),
    signal(
      "robots",
      "robots.txt + Content-Signal",
      robotsTxt.includes("Content-Signal:") || hasManifest,
      2,
      "Emit robots.txt with a Content-Signal line (default in `generate`)."
    ),
    signal(
      "jsonld",
      "JSON-LD ready (per-page identity)",
      jsonLdReady,
      2,
      "Ensure every page has a title, description, and lastModified so renderJsonLd emits valid TechArticle."
    ),
    {
      id: "descriptions",
      label: "description coverage",
      points: Math.round(descriptionCoverage * 2),
      max: 2,
      ...descriptionFix(pages.length, describedPages),
    },
    signal(
      "geo-structure",
      "GEO structure (headings, code labels, alt text)",
      geoClean,
      2,
      "Run `leadtype lint` and fix the geo:* warnings."
    ),
  ];

  const integrationSignals: ScoreSignal[] = [
    signal(
      "mcp-ready",
      "MCP-ready artifacts",
      hasIndex && hasManifest,
      2,
      "Emit search-index.json + agent-readability.json so `leadtype mcp` / createMcpHandler can serve."
    ),
    signal(
      "skills",
      "agent-skills surface",
      has(".well-known", "agent-skills", "index.json"),
      2,
      "Enable `agents.skills` so generate emits /.well-known/agent-skills."
    ),
    signal(
      "offline-docs",
      "offline docs (AGENTS.md or markdown mirror)",
      has("AGENTS.md") || has("docs", "index.md") || pages.length > 0,
      1,
      "Emit AGENTS.md (`--bundle`) or the markdown mirror so on-disk agents can read the docs."
    ),
  ];

  const identity: ScoreDimension = {
    id: "identity",
    label: "Identity",
    inLane: true,
    ...dimensionPoints(identitySignals),
    signals: identitySignals,
  };
  const integration: ScoreDimension = {
    id: "integration",
    label: "Agent Integration",
    inLane: true,
    ...dimensionPoints(integrationSignals),
    signals: integrationSignals,
  };
  const outOfLane: ScoreDimension[] = OUT_OF_LANE.map((dim) => ({
    ...dim,
    inLane: false,
    points: 0,
    max: 0,
    signals: [],
  }));

  const addressablePoints = identity.points + integration.points;
  const addressableMax = identity.max + integration.max;
  const score =
    addressableMax > 0
      ? Math.round((addressablePoints / addressableMax) * 100)
      : 0;

  const fixes = [...identitySignals, ...integrationSignals]
    .filter((s) => s.points < s.max && s.fix)
    .sort((a, b) => b.max - a.max - (b.points - a.points))
    .map((s) => s.fix as string);

  return {
    score,
    dimensions: [identity, integration, ...outOfLane],
    fixes,
  };
}
