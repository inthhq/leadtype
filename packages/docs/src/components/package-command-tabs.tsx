"use client";

import { type ReactNode, useState } from "react";
import {
  MANAGERS,
  type PackageCommandMode,
  type PackageManager,
  resolvePackageCommand,
} from "../internal/package-managers";

export type {
  PackageCommandMode,
  PackageManager,
} from "../internal/package-managers";

export type PackageCommandTabsProps = {
  /** Command template — `{pm}` is replaced with the active package manager. E.g. "{pm} install @inth/docs" */
  command?: string;
  /** Or pass pre-rendered commands per manager */
  commands?: Partial<Record<PackageManager, string>>;
  defaultManager?: PackageManager;
  mode?: PackageCommandMode;
  children?: ReactNode;
};

export function PackageCommandTabs({
  command,
  commands,
  defaultManager = "npm",
  mode = "run",
  children,
}: PackageCommandTabsProps) {
  const [active, setActive] = useState<PackageManager>(defaultManager);
  const resolved = resolvePackageCommand(active, command, commands, mode);

  return (
    <div data-inth-package-command-tabs="">
      {/* Plain button group — intentionally not using role="tablist" /
          role="tab" since we don't implement the full tabs keyboard pattern
          (roving tabindex, ArrowLeft/Right, associated tabpanel). */}
      <fieldset data-inth-package-command-tabs-list="">
        <legend data-inth-package-command-tabs-legend="">
          Package manager
        </legend>
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
      </fieldset>
      {resolved ? (
        <pre data-inth-package-command-tabs-output="" data-manager={active}>
          <code>{resolved}</code>
        </pre>
      ) : null}
      {children}
    </div>
  );
}
