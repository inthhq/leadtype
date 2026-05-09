"use client";

import { type ReactNode, useState } from "react";

// Single source of truth — derive the union type from the tuple.
const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof MANAGERS)[number];
export type CommandMode = "run" | "install" | "create";

interface BaseCommandTabsProps {
  children?: ReactNode;
  /** Or pass pre-rendered commands per manager */
  commands?: Partial<Record<PackageManager, string>>;
  defaultManager?: PackageManager;
}

type ModeCommandTabsProps = BaseCommandTabsProps & {
  /** Command template. `{pm}` is replaced with the active package manager. */
  command: string;
  /** When set, treat `command` as a package or CLI name and render package-manager-specific commands. */
  mode: CommandMode;
};

type TemplateCommandTabsProps = BaseCommandTabsProps & {
  /** Command template. `{pm}` is replaced with the active package manager. */
  command?: string;
  mode?: never;
};

export type CommandTabsProps = ModeCommandTabsProps | TemplateCommandTabsProps;

const MODE_COMMANDS: Record<CommandMode, Record<PackageManager, string>> = {
  install: {
    npm: "npm install {command}",
    pnpm: "pnpm add {command}",
    yarn: "yarn add {command}",
    bun: "bun add {command}",
  },
  create: {
    npm: "npm create {command}",
    pnpm: "pnpm create {command}",
    yarn: "yarn create {command}",
    bun: "bun create {command}",
  },
  run: {
    npm: "npx {command}",
    pnpm: "pnpm dlx {command}",
    yarn: "yarn dlx {command}",
    bun: "bunx {command}",
  },
};

function resolveCommand(
  manager: PackageManager,
  command: string | undefined,
  mode: CommandMode | undefined,
  commands: Partial<Record<PackageManager, string>> | undefined
): string {
  // Presence check so an explicit "" override wins over the template fallback.
  const explicit = commands?.[manager];
  if (explicit !== undefined) {
    return explicit;
  }
  if (command) {
    if (mode) {
      return MODE_COMMANDS[mode][manager].replace("{command}", command);
    }
    return command.replaceAll("{pm}", manager);
  }
  return "";
}

export function CommandTabs({
  command,
  mode,
  commands,
  defaultManager = "npm",
  children,
}: CommandTabsProps) {
  const [active, setActive] = useState<PackageManager>(defaultManager);
  const resolved = resolveCommand(active, command, mode, commands);

  return (
    <div data-leadtype-command-tabs="">
      {/* Plain button group — intentionally not using role="tablist" /
          role="tab" since we don't implement the full tabs keyboard pattern
          (roving tabindex, ArrowLeft/Right, associated tabpanel). */}
      <fieldset data-leadtype-command-tabs-list="">
        <legend data-leadtype-command-tabs-legend="">Package manager</legend>
        {MANAGERS.map((manager) => (
          <button
            aria-pressed={manager === active}
            data-active={manager === active || undefined}
            data-leadtype-command-tabs-tab=""
            key={manager}
            onClick={() => setActive(manager)}
            type="button"
          >
            {manager}
          </button>
        ))}
      </fieldset>
      {resolved ? (
        <pre data-leadtype-command-tabs-output="" data-manager={active}>
          <code>{resolved}</code>
        </pre>
      ) : null}
      {children}
    </div>
  );
}
