import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocsSkillSpec } from "./llm";

const NON_SLUG_PATTERN = /[^a-z0-9]+/g;
const EDGE_DASH_PATTERN = /^-+|-+$/g;
const WELL_KNOWN_DIR = ".well-known";
const SKILLS_DIR = "agent-skills";
const DISCOVERY_SCHEMA_URL =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const YAML_NEEDS_QUOTE = /[:#]/;
// A skill name becomes a `.well-known/agent-skills/<name>/` directory and the
// agentskills.io identifier, so it must be a safe lowercase slug — never a path
// fragment that could escape the output dir.
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// The discovery v0.2.0 spec caps entry descriptions; longer ones make clients
// drop the entry, so fail at generate time instead.
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

export type GenerateSkillArtifactsConfig = {
  /** Output root. Site mode writes under `.well-known/`; bundle mode writes `SKILL.md`. */
  outDir: string;
  /** Docs source root, used to resolve a skill's `bodyPath`. */
  srcDir?: string;
  baseUrl?: string;
  product: { name: string; summary: string };
  /** `agents.skills` config. */
  skills?: {
    docsSkill?: boolean;
    agentCard?: boolean;
    items?: DocsSkillSpec[];
  };
  /** `"site"` (default) emits the `.well-known` surface; `"bundle"` emits one `SKILL.md`. */
  mode?: "site" | "bundle";
  /** Whether a docs MCP server is enabled — changes the docs-skill body + agent-card url. */
  mcpEnabled?: boolean;
  /** Resolved docs MCP endpoint, preferably absolute when `baseUrl` is known. */
  mcpEndpoint?: string;
  /** A2A agent-card `provider` (e.g. the docs maintainers). */
  provider?: { organization: string; url?: string };
  /** A2A agent-card `documentationUrl`. Defaults to `${baseUrl}/docs`. */
  documentationUrl?: string;
  /** A2A agent-card `version`. Defaults to `1.0.0`. */
  version?: string;
};

export type GenerateSkillArtifactsResult = {
  files: string[];
  /** Skill names emitted, in order. */
  skills: string[];
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(NON_SLUG_PATTERN, "-")
    .replace(EDGE_DASH_PATTERN, "");
}

function yamlString(value: string): string {
  return YAML_NEEDS_QUOTE.test(value) ? JSON.stringify(value) : value;
}

/** Build the auto docs-skill, pointed at whichever docs surface exists. */
function buildDocsSkill(config: GenerateSkillArtifactsConfig): DocsSkillSpec {
  const { product } = config;
  const name = `${slugify(product.name) || "product"}-docs`;
  const description = `Read and search the ${product.name} documentation. Use when working with ${product.name} — its setup, configuration, API, and behavior.`;

  const lines: string[] = [
    `# ${product.name} documentation`,
    "",
    product.summary,
    "",
  ];
  if (config.mode === "bundle") {
    lines.push(
      `To work with ${product.name}, read its bundled docs — they ship with the package and are version-matched to the installed code:`,
      "",
      "- Start with `./AGENTS.md`; it links every per-topic Markdown file under `./docs/`.",
      "- Prefer these local files over fetching anything over the network."
    );
  } else {
    lines.push(
      `To work with ${product.name}, read its documentation:`,
      "",
      "- Start at `/llms.txt` (task-routed index) or `/llms-full.txt` (full context).",
      "- Every page is also available as Markdown at its `.md` URL."
    );
    if (config.mcpEnabled) {
      const fallbackEndpoint = config.baseUrl
        ? `${config.baseUrl.replace(/\/+$/, "")}/mcp`
        : undefined;
      const endpointValue = config.mcpEndpoint ?? fallbackEndpoint;
      const endpoint = endpointValue ? ` at \`${endpointValue}\`` : "";
      lines.push(
        `- For targeted retrieval, connect the docs MCP server${endpoint} and use its \`search-docs\` and \`get-page\` tools.`
      );
    }
  }
  return {
    name,
    description,
    metadata: { source: "leadtype" },
    body: `${lines.join("\n")}\n`,
  };
}

async function resolveBody(
  skill: DocsSkillSpec,
  srcDir: string | undefined
): Promise<string> {
  if (skill.body !== undefined) {
    return skill.body;
  }
  if (skill.bodyPath) {
    const base = srcDir ? path.resolve(srcDir) : process.cwd();
    return await readFile(path.resolve(base, skill.bodyPath), "utf8");
  }
  return `# ${skill.name}\n\n${skill.description}\n`;
}

function renderSkillMd(skill: DocsSkillSpec, body: string): string {
  const fm: string[] = [
    "---",
    `name: ${yamlString(skill.name)}`,
    `description: ${yamlString(skill.description)}`,
  ];
  if (skill.license) {
    fm.push(`license: ${yamlString(skill.license)}`);
  }
  if (skill.compatibility) {
    fm.push(`compatibility: ${yamlString(skill.compatibility)}`);
  }
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    fm.push(`allowed-tools: ${skill.allowedTools.join(" ")}`);
  }
  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    fm.push("metadata:");
    for (const [key, value] of Object.entries(skill.metadata)) {
      fm.push(`  ${key}: ${yamlString(value)}`);
    }
  }
  fm.push("---", "");
  return `${fm.join("\n")}${body.endsWith("\n") ? body : `${body}\n`}`;
}

function integrity(content: string): string {
  return `sha256-${createHash("sha256").update(content).digest("base64")}`;
}

// Discovery v0.2.0 digests are `sha256:<hex>`, not the SRI `sha256-<base64>`
// kept in the legacy `integrity` field.
function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** Build an A2A AgentCard (https://agent2agent.info) describing the skills surface. */
function buildAgentCard(
  config: GenerateSkillArtifactsConfig,
  skills: DocsSkillSpec[]
): Record<string, unknown> {
  const baseUrl = config.baseUrl?.replace(/\/+$/, "") ?? "";
  const mcpEndpoint = config.mcpEndpoint ?? (baseUrl ? `${baseUrl}/mcp` : "");
  // The agent's endpoint: the MCP server when enabled, else the docs site.
  const url = config.mcpEnabled ? mcpEndpoint : baseUrl;
  const documentationUrl =
    config.documentationUrl ?? (baseUrl ? `${baseUrl}/docs` : undefined);
  return {
    name: config.product.name,
    description: config.product.summary,
    ...(url ? { url } : {}),
    version: config.version ?? "1.0.0",
    ...(config.provider
      ? {
          provider: {
            organization: config.provider.organization,
            ...(config.provider.url ? { url: config.provider.url } : {}),
          },
        }
      : {}),
    ...(documentationUrl ? { documentationUrl } : {}),
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/markdown"],
    skills: skills.map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      tags: ["documentation"],
    })),
  };
}

/**
 * Emit the agent-skills surface from `agents.skills`. Site mode writes
 * `/.well-known/agent-skills/index.json` + `<name>/SKILL.md` (+ `agent-card.json`);
 * bundle mode writes a single `SKILL.md` (the docs-skill) next to `AGENTS.md`.
 * The auto docs-skill is default-on and points at whichever docs surface exists
 * (bundled `AGENTS.md`, else `llms.txt` + the MCP server). All static — no runtime.
 */
export async function generateSkillArtifacts(
  config: GenerateSkillArtifactsConfig
): Promise<GenerateSkillArtifactsResult> {
  const outDir = path.resolve(config.outDir);
  const mode = config.mode ?? "site";
  const docsSkill =
    config.skills?.docsSkill === false ? null : buildDocsSkill(config);

  const skills: DocsSkillSpec[] = [
    ...(docsSkill ? [docsSkill] : []),
    ...(config.skills?.items ?? []),
  ];

  const files: string[] = [];

  if (mode === "bundle") {
    // The package root SKILL.md (next to AGENTS.md) is the offline docs pointer —
    // always the auto docs-skill, never a capability skill. Capability `items`
    // are a site-surface concept (one file each under /.well-known/agent-skills),
    // not a single root file, so bundle mode ignores them. With `docsSkill: false`
    // there is nothing to point at, so no SKILL.md is emitted (and a stale one
    // from a prior run is removed).
    if (!docsSkill) {
      await rm(path.join(outDir, "SKILL.md"), { force: true });
      return { files: [], skills: [] };
    }
    const body = await resolveBody(docsSkill, config.srcDir);
    const skillPath = path.join(outDir, "SKILL.md");
    await writeFile(skillPath, renderSkillMd(docsSkill, body));
    return { files: [skillPath], skills: [docsSkill.name] };
  }

  const skillsRoot = path.join(outDir, WELL_KNOWN_DIR, SKILLS_DIR);
  const cardPath = path.join(outDir, WELL_KNOWN_DIR, "agent-card.json");

  // Validate every skill before touching the existing surface — a throw after
  // the rm below would erase the last good output and leave a partial rewrite.
  for (const skill of skills) {
    if (!SKILL_NAME_PATTERN.test(skill.name)) {
      throw new Error(
        `leadtype: invalid skill name "${skill.name}". Skill names must be a lowercase slug ` +
          '(letters, digits, hyphens; starting alphanumeric), e.g. "deploy-acme".'
      );
    }
    if (skill.description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
      throw new Error(
        `leadtype: skill "${skill.name}" description is ${skill.description.length} characters; ` +
          `the Agent Skills discovery format caps descriptions at ${MAX_SKILL_DESCRIPTION_LENGTH}.`
      );
    }
  }

  // Clear generated artifacts first on every run, so skills/cards the config no
  // longer emits (renamed, removed, or fully disabled) don't linger and keep
  // getting discovered by clients.
  await rm(skillsRoot, { recursive: true, force: true });

  if (skills.length === 0) {
    // Whole surface disabled — also drop a stale agent card from a prior run.
    await rm(cardPath, { force: true });
    return { files: [], skills: [] };
  }

  await mkdir(skillsRoot, { recursive: true });

  const manifestEntries: {
    name: string;
    description: string;
    type: "skill-md";
    url: string;
    digest: string;
    path: string;
    integrity: string;
  }[] = [];

  for (const skill of skills) {
    const body = await resolveBody(skill, config.srcDir);
    const content = renderSkillMd(skill, body);
    const dir = path.join(skillsRoot, skill.name);
    await mkdir(dir, { recursive: true });
    const skillPath = path.join(dir, "SKILL.md");
    await writeFile(skillPath, content);
    files.push(skillPath);
    manifestEntries.push({
      name: skill.name,
      description: skill.description,
      type: "skill-md",
      url: `./${skill.name}/SKILL.md`,
      digest: digest(content),
      // Legacy pre-0.2.0 leadtype fields; the spec ignores unknown keys.
      path: `./${skill.name}/SKILL.md`,
      integrity: integrity(content),
    });
  }

  const indexPath = path.join(skillsRoot, "index.json");
  await writeFile(
    indexPath,
    `${JSON.stringify(
      {
        $schema: DISCOVERY_SCHEMA_URL,
        skills: manifestEntries,
      },
      null,
      2
    )}\n`
  );
  files.push(indexPath);

  if (config.skills?.agentCard === false) {
    // Card disabled but skills exist — remove any stale card from a prior run.
    await rm(cardPath, { force: true });
  } else {
    await writeFile(
      cardPath,
      `${JSON.stringify(buildAgentCard(config, skills), null, 2)}\n`
    );
    files.push(cardPath);
  }

  return { files, skills: skills.map((s) => s.name) };
}
