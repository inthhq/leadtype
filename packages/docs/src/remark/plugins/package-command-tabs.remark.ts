/** @biome-ignore lint/style/useDefaultSwitchClause: the switch statement is complete */
/** @biome-ignore lint/nursery/noUnnecessaryConditions: these are packages */
import type { Root } from "mdast";
import type { Transformer } from "unified";
import {
  COMMANDS,
  MANAGERS as DEFAULT_MANAGERS,
  type PackageCommandMode as Mode,
  type PackageManager as Pm,
} from "../../internal/package-managers";
import {
  createInlineCode,
  createJsxComponentProcessor,
  createTable,
  getAttributeValue,
} from "../libs";

type Options = {
  /** Column labels. */
  labels?: { pm?: string; command?: string };
  /** Which package managers to include and in what order. */
  managers?: Pm[];
};

const DEFAULT_LABELS = { pm: "Package manager", command: "Command" } as const;

function cmdsFor(pm: Pm, pkgCmd: string, mode: Mode): string {
  const template = COMMANDS[mode][pm];
  return template.replace("{pkg}", pkgCmd);
}

export function remarkPackageCommandTabsToMarkdown(
  opts: Options = {}
): Transformer<Root, Root> {
  const labels = { ...DEFAULT_LABELS, ...(opts.labels ?? {}) };
  const managers = [...(opts.managers ?? DEFAULT_MANAGERS)];

  return createJsxComponentProcessor("PackageCommandTabs", (node) => {
    const rawCommand = (getAttributeValue(node, "command") ?? "").trim();
    const rawMode = (getAttributeValue(node, "mode") ?? "run").trim();
    const mode: Mode = rawMode === "install" ? "install" : "run";

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
  });
}
