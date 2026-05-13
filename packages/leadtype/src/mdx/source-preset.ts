/**
 * Remark preset for **source-MDX consumers** — bundlers and frameworks that
 * compile the original `.mdx` files into live components (Next App Router,
 * Vite + @mdx-js, fumadocs, etc.).
 *
 * This preset performs **build-time resolution only**:
 *   1. `<include>` / `<import>` partials are expanded.
 *   2. `<ExtractedTypeTable name path />` is resolved to `<TypeTable properties={…} />`.
 *   3. Placeholder strings inside frontmatter / content are resolved.
 *   4. Authoring-only `import` statements are stripped.
 *
 * It deliberately leaves every other custom tag (`<Callout>`, `<Tabs>`,
 * `<Steps>`, `<Mermaid>`, `<TypeTable>`, …) as JSX so the consumer's runtime
 * components render them. For the flattened-markdown agent pipeline, use
 * `defaultRemarkPlugins` from `leadtype/remark` instead.
 */

import type { PluggableList } from "unified";
import { remarkResolveDocPlaceholders } from "../remark/plugins/doc-placeholders.remark";
import { remarkInclude } from "../remark/plugins/include.remark";
import { remarkRemoveImports } from "../remark/plugins/remove-imports.remark";
import { remarkResolveTypeTableJsx } from "../remark/plugins/type-table-jsx.remark";

/**
 * Default remark plugin list for compiling source MDX in a host bundler.
 * Order matters: includes expand first (so type-table / placeholder passes
 * see merged content), then type-table extraction, then placeholder resolution,
 * then import stripping.
 */
export const mdxSourcePlugins: PluggableList = [
  remarkInclude,
  remarkResolveTypeTableJsx,
  remarkResolveDocPlaceholders,
  remarkRemoveImports,
];
