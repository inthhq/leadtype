// biome-ignore lint/suspicious/noExplicitAny: @next/mdx's MDXComponents type expects a permissive index signature
type MDXComponents = Record<string, any>;

import { mdxComponents } from "./lib/mdx-components";

/**
 * `@next/mdx` reads this file to discover MDX components. Re-export the
 * shared map from `lib/mdx-components.tsx` so the same components power
 * both Server Component rendering and direct MDX imports.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components, ...mdxComponents };
}
