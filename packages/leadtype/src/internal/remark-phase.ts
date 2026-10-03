/**
 * Phase-ordered markdown transform scheduling.
 *
 * The agent-flattening pipeline must run plugins in a fixed order regardless of
 * the order they appear in a user-supplied `markdownTransforms` array:
 *
 *   resolve  → expand includes, resolve placeholders, strip imports
 *   custom   → custom component flatteners (`defineComponentFlattener`)
 *   flatten  → built-in component flatteners (`<Callout>` → blockquote, …)
 *   post     → reserved for output normalization
 *
 * Plugins are tagged with a non-enumerable symbol; `sortRemarkPluginsByPhase`
 * does a *stable* partition so relative order within a phase (and the existing
 * behavior of untagged plugins, which default to `flatten`) is preserved. This
 * lets consumers write `[...defaultMarkdownTransforms, myFlattener]` and still get
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

export const REMARK_FLATTENER_NAMES = Symbol.for(
  "leadtype.remark.flattenerNames"
);

type FlattenerNameTaggable = {
  [REMARK_FLATTENER_NAMES]?: string[];
};

/**
 * Tag a flattener plugin with the component name(s) it handles, so tooling
 * (e.g. the lint `unflattened-component` rule) can recognize custom components
 * without running the pipeline. Mutates the function with a non-enumerable
 * property and returns it for chaining.
 */
export function tagFlattenerNames<T>(plugin: T, names: string[]): T {
  try {
    Object.defineProperty(
      plugin as FlattenerNameTaggable,
      REMARK_FLATTENER_NAMES,
      {
        value: names,
        enumerable: false,
        configurable: true,
        writable: true,
      }
    );
  } catch {
    // Frozen/primitive plugins can't be tagged — callers fall back to treating
    // the component as unrecognized, which is the safe (warn) default.
  }
  return plugin;
}

/** Read the component names a plugin entry flattens (bare attacher or `[attacher, ...opts]`). */
export function getFlattenerNames(entry: Pluggable): string[] {
  const fn = Array.isArray(entry) ? entry[0] : entry;
  const names = (fn as FlattenerNameTaggable | undefined)?.[
    REMARK_FLATTENER_NAMES
  ];
  return Array.isArray(names) ? names : [];
}

/** Read the phase of a plugin entry (bare attacher or `[attacher, ...opts]`). */
export function getPhase(entry: Pluggable): RemarkPhase {
  const fn = Array.isArray(entry) ? entry[0] : entry;
  const phase = (fn as Taggable | undefined)?.[REMARK_PHASE];
  // Validate against the known phases: an unrecognized tag would otherwise fall
  // into no bucket and silently drop the plugin from the pipeline.
  return phase && PHASE_ORDER.includes(phase) ? phase : DEFAULT_PHASE;
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
