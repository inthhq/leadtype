/** @biome-ignore lint/style/useDefaultSwitchClause: the switch statement is complete */
/** @biome-ignore lint/nursery/noUnnecessaryConditions: these are packages */
import type { Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import {
  createInlineCode,
  createJsxComponentProcessor,
  createTable,
  getAttributeValue,
  type MdxNode,
} from "../libs";

type Mode = "run" | "install" | "create";

type Options = {
  /** Column labels. */
  labels?: { pm?: string; command?: string };
  /** Which package managers to include and in what order. */
  managers?: Array<"npm" | "pnpm" | "yarn" | "bun">;
};

const DEFAULT_LABELS = { pm: "Package manager", command: "Command" } as const;
const DEFAULT_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

const COMMANDS = {
  install: {
    npm: "npm install {pkg}",
    pnpm: "pnpm add {pkg}",
    yarn: "yarn add {pkg}",
    bun: "bun add {pkg}",
  },
  create: {
    npm: "npm create {pkg}",
    pnpm: "pnpm create {pkg}",
    yarn: "yarn create {pkg}",
    bun: "bun create {pkg}",
  },
  run: {
    npm: "npx {pkg}",
    pnpm: "pnpm dlx {pkg}",
    yarn: "yarn dlx {pkg}",
    bun: "bunx {pkg}",
  },
} as const;

type Pm = keyof (typeof COMMANDS)["run"];

function cmdsFor(pm: Pm, pkgCmd: string, mode: Mode): string {
  const template = COMMANDS[mode][pm];
  return template.replace("{pkg}", pkgCmd);
}

function unwrapStringLiteralExpression(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed.at(0);

  if (
    quote &&
    (quote === '"' || quote === "'" || quote === "`") &&
    trimmed.endsWith(quote)
  ) {
    return trimmed.slice(1, -1);
  }

  return value;
}

export function remarkCommandTabsToMarkdown(
  opts: Options = {}
): Transformer<Root, Root> {
  return createJsxComponentProcessor("CommandTabs", (node) =>
    commandTabsToMarkdown(node, opts)
  );
}

export function commandTabsToMarkdown(
  node: MdxNode,
  opts: Options = {}
): RootContent[] {
  const labels = { ...DEFAULT_LABELS, ...(opts.labels ?? {}) };
  const managers = [...(opts.managers ?? DEFAULT_MANAGERS)];
  const rawCommand = unwrapStringLiteralExpression(
    getAttributeValue(node, "command") ?? ""
  ).trim();
  const rawMode = unwrapStringLiteralExpression(
    getAttributeValue(node, "mode") ?? "run"
  ).trim();
  const mode: Mode =
    rawMode === "install" || rawMode === "create" ? rawMode : "run";

  if (!rawCommand) {
    return [];
  }

  // Build table data
  const headers = [labels.pm, labels.command];
  const rows = managers.map((pm) => {
    const cmd = cmdsFor(pm, rawCommand, mode);
    return [pm, [createInlineCode(cmd)]];
  });

  const table = createTable(headers, rows, ["left", "left"]);
  return [table];
}
