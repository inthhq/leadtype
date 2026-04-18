"use client";

import { type ReactNode, useState } from "react";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type PackageCommandTabsProps = {
  /** Command template — `{pm}` is replaced with the active package manager. E.g. "{pm} install @inth/docs" */
  command?: string;
  /** Or pass pre-rendered commands per manager */
  commands?: Partial<Record<PackageManager, string>>;
  defaultManager?: PackageManager;
  children?: ReactNode;
};

const MANAGERS: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

function resolveCommand(
  manager: PackageManager,
  command: string | undefined,
  commands: Partial<Record<PackageManager, string>> | undefined
): string {
  const explicit = commands?.[manager];
  if (explicit) {
    return explicit;
  }
  if (command) {
    return command.replaceAll("{pm}", manager);
  }
  return "";
}

export function PackageCommandTabs({
  command,
  commands,
  defaultManager = "npm",
  children,
}: PackageCommandTabsProps) {
  const [active, setActive] = useState<PackageManager>(defaultManager);
  const resolved = resolveCommand(active, command, commands);

  return (
    <div data-inth-package-command-tabs="">
      {/* Plain button group — intentionally not using role="tablist" /
          role="tab" since we don't implement the full tabs keyboard pattern
          (roving tabindex, ArrowLeft/Right, associated tabpanel). */}
      <div data-inth-package-command-tabs-list="">
        {MANAGERS.map((manager) => (
          <button
            aria-pressed={manager === active}
            data-active={manager === active || undefined}
            data-inth-package-command-tab=""
            key={manager}
            onClick={() => setActive(manager)}
            type="button"
          >
            {manager}
          </button>
        ))}
      </div>
      {resolved ? (
        <pre data-inth-package-command-tabs-output="" data-manager={active}>
          <code>{resolved}</code>
        </pre>
      ) : null}
      {children}
    </div>
  );
}
