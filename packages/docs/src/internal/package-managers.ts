// Single source of truth for package-manager command templates.
// Imported by both the React component (`components/package-command-tabs.tsx`)
// and the remark plugin (`remark/plugins/package-command-tabs.remark.ts`).

export const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof MANAGERS)[number];

export type PackageCommandMode = "run" | "install";

export const COMMANDS: Record<
  PackageCommandMode,
  Record<PackageManager, string>
> = {
  install: {
    npm: "npm install {pkg}",
    pnpm: "pnpm add {pkg}",
    yarn: "yarn add {pkg}",
    bun: "bun add {pkg}",
  },
  run: {
    npm: "npx {pkg}",
    pnpm: "pnpm dlx {pkg}",
    yarn: "yarn dlx {pkg}",
    bun: "bunx {pkg}",
  },
};

/**
 * Resolve the rendered command for a single package manager. Three precedence
 * rules:
 *   1. An explicit `commands[manager]` override wins (including `""` to suppress).
 *   2. A `command` template containing `{pm}` is treated as a literal template.
 *   3. Otherwise `command` is treated as a package/CLI name and expanded via
 *      `COMMANDS[mode][manager]`.
 */
export function resolvePackageCommand(
  manager: PackageManager,
  command: string | undefined,
  commands: Partial<Record<PackageManager, string>> | undefined,
  mode: PackageCommandMode
): string {
  const explicit = commands?.[manager];
  if (explicit !== undefined) {
    return explicit;
  }
  if (command) {
    if (command.includes("{pm}")) {
      return command.replaceAll("{pm}", manager);
    }
    return COMMANDS[mode][manager].replace("{pkg}", command);
  }
  return "";
}
