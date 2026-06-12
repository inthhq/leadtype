export const MISSING_SDK_MESSAGE =
  "leadtype mcp: the optional peer dependency @modelcontextprotocol/sdk is not installed. " +
  "Install it to run the docs MCP server: `bun add @modelcontextprotocol/sdk`.";

const MODULE_NOT_FOUND_CODES = new Set([
  "ERR_MODULE_NOT_FOUND", // Node ESM
  "MODULE_NOT_FOUND", // Bun / CJS
]);
const MODULE_NOT_FOUND_MESSAGE = /cannot find (module|package)/i;

/**
 * Whether an error is a module-resolution failure (vs. a module that loaded and
 * threw). Used by the CLI to turn a missing optional SDK peer into the
 * actionable {@link MISSING_SDK_MESSAGE} instead of a raw loader error.
 *
 * Kept in its own SDK-free module so SDK-optional callers (the CLI's
 * `--check` path, artifact loading) can import it without pulling in the
 * statically-imported SDK from `server.ts` / `http.ts` / `stdio.ts`.
 */
export function isMissingSdkError(error: unknown): boolean {
  const code =
    error instanceof Error && "code" in error
      ? (error as { code?: string }).code
      : undefined;
  const message = error instanceof Error ? error.message : "";
  return (
    (code !== undefined && MODULE_NOT_FOUND_CODES.has(code)) ||
    MODULE_NOT_FOUND_MESSAGE.test(message)
  );
}
