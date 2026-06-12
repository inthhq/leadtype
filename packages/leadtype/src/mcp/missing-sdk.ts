const SDK_PACKAGE_NAME = "@modelcontextprotocol/sdk";

export const MISSING_SDK_MESSAGE = `leadtype mcp: the optional peer dependency ${SDK_PACKAGE_NAME} is not installed. Install it to run the docs MCP server: \`bun add ${SDK_PACKAGE_NAME}\`.`;

const MODULE_NOT_FOUND_CODES = new Set([
  "ERR_MODULE_NOT_FOUND", // Node ESM
  "MODULE_NOT_FOUND", // Bun / CJS
]);
const MODULE_NOT_FOUND_MESSAGE = /cannot find (module|package)/i;

/**
 * Whether an error is the SDK failing to resolve (vs. a module that loaded and
 * threw, or some other dependency failing to resolve). Both Node ESM and Bun
 * name the unresolvable specifier in the message, so requiring the SDK package
 * name keeps unrelated module-resolution failures from being mislabeled with
 * {@link MISSING_SDK_MESSAGE}'s install guidance.
 *
 * Kept in its own SDK-free module so SDK-optional callers (the CLI's
 * `--check` path, artifact loading) can import it without pulling in the
 * statically-imported SDK from `server.ts` / `http.ts` / `stdio.ts`.
 */
export function isMissingSdkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = "code" in error ? (error as { code?: string }).code : undefined;
  const isModuleNotFound =
    (code !== undefined && MODULE_NOT_FOUND_CODES.has(code)) ||
    MODULE_NOT_FOUND_MESSAGE.test(error.message);
  return isModuleNotFound && error.message.includes(SDK_PACKAGE_NAME);
}
