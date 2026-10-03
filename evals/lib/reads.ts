import type { ToolCall } from "./transcript";

/**
 * A `read` tool call that actually returned file content.
 *
 * The recorded `resultSummary` is `error: …` (and `isError` is set on
 * transcripts produced after this field was added) whenever the read threw —
 * most importantly when control mode has deleted the bundle, so the agent's
 * attempt to read `node_modules/leadtype/AGENTS.md` fails with ENOENT.
 *
 * Those failed attempts must NOT count as "the agent read our docs": counting
 * them let control report bundle usage for files that don't exist. We accept
 * both signals so the predicate is correct for transcripts archived before
 * `isError` existed (fall back to the `error:` prefix the recorder always
 * writes) and for newer ones (use the structured flag).
 */
export function readSucceeded(call: ToolCall): boolean {
  if (call.tool !== "read") {
    return false;
  }
  if (call.isError === true) {
    return false;
  }
  return !(call.resultSummary?.startsWith("error:") ?? false);
}
