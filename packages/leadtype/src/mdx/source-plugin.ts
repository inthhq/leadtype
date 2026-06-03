/**
 * `leadtype/mdx/source` — the MDX source preset as a **single, Turbopack-safe**
 * remark plugin.
 *
 * Turbopack (and any bundler that serializes its loader config across a
 * worker/Rust boundary) cannot accept function-instance remark plugins. It
 * requires entries of the form `["module-specifier", options]`, where the
 * module's default export is the plugin and `options` is a plain object.
 *
 * `createMdxSourcePlugins()` returns a `PluggableList` of function instances —
 * fine for Vite/webpack, rejected by Turbopack. This module wraps that preset
 * as one resolvable plugin so Next App Router on Turbopack can use:
 *
 * @example
 * ```js
 * // next.config.mjs
 * import createMDX from "@next/mdx";
 * const withMdx = createMDX({
 *   options: {
 *     remarkPlugins: [
 *       ["leadtype/mdx/source", { typeTableBasePath: "./content" }],
 *     ],
 *   },
 * });
 * ```
 *
 * It registers the preset via `this.use(...)` (the unified "preset-as-plugin"
 * idiom), so every sub-plugin is attached to the real processor and keeps its
 * normal binding — behaviour is identical to spreading `createMdxSourcePlugins`.
 */

import type { Plugin } from "unified";
import {
  createMdxSourcePlugins,
  type MdxSourcePluginsOptions,
} from "./source-preset";

const remarkLeadtypeSource: Plugin<[MdxSourcePluginsOptions?]> =
  function remarkLeadtypeSource(options = {}) {
    this.use(createMdxSourcePlugins(options));
  };

export type { MdxSourcePluginsOptions } from "./source-preset";
export default remarkLeadtypeSource;
