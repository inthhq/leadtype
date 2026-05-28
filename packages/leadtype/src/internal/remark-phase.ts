/**
 * Phase-ordered remark plugin scheduling.
 *
 * The agent-flattening pipeline must run plugins in a fixed order regardless of
 * the order they appear in a user-supplied `remarkPlugins` array:
 *
 *   resolve  → expand includes, resolve placeholders, strip imports
 *   custom   → custom component flatteners (`defineComponentFlattener`)
 *   flatten  → built-in component flatteners (`<Callout>` → blockquote, …)
 *   post     → reserved for output normalization
 *
 * Plugins are tagged with a non-enumerable symbol; `sortRemarkPluginsByPhase`
 * does a *stable* partition so relative order within a phase (and the existing
 * behavior of untagged plugins, which default to `flatten`) is preserved. This
 * lets consumers write `[...defaultRemarkPlugins, myFlattener]` and still get
 * correct scheduling.
 */

import type { Pluggable, PluggableList } from "unified";

export const REMARK_PHASE = Symbol.for("leadtype.remark.phase");

export type RemarkPhase = "resolve" | "custom" | "flatten" | "post";

const PHASE_ORDER: readonly RemarkPhase[] = [
  "resolve",
  "custom",
  "flatten",
  "post",
];

const DEFAULT_PHASE: RemarkPhase = "flatten";

type Taggable = {
  [REMARK_PHASE]?: RemarkPhase;
};

/**
 * Tag a plugin (attacher function) with the phase it should run in. Mutates the
 * function with a non-enumerable property and returns it for chaining.
 */
export function tagPhase<T>(plugin: T, phase: RemarkPhase): T {
  try {
    Object.defineProperty(plugin as Taggable, REMARK_PHASE, {
      value: phase,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen/primitive plugins can't be tagged — they fall back to the default
    // phase, which matches their previous unordered behavior.
  }
  return plugin;
}

/** Read the phase of a plugin entry (bare attacher or `[attacher, ...opts]`). */
export function getPhase(entry: Pluggable): RemarkPhase {
  const fn = Array.isArray(entry) ? entry[0] : entry;
  const phase = (fn as Taggable | undefined)?.[REMARK_PHASE];
  return phase ?? DEFAULT_PHASE;
}

/**
 * Stable-sort a plugin list into phase order. Entries keep their relative order
 * within each phase, so the result is deterministic for a given input array
 * (important for the processor cache in `convert.ts`).
 */
export function sortRemarkPluginsByPhase(
  plugins: PluggableList
): PluggableList {
  const buckets = new Map<RemarkPhase, Pluggable[]>(
    PHASE_ORDER.map((phase) => [phase, []])
  );
  for (const entry of plugins) {
    buckets.get(getPhase(entry))?.push(entry);
  }
  return PHASE_ORDER.flatMap((phase) => buckets.get(phase) ?? []);
}
