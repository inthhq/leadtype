import { mdxComponents } from "@inth/docs";
import type { MDXComponents } from "mdx/types";

export function useMDXComponents(
  components: MDXComponents = {}
): MDXComponents {
  return {
    ...mdxComponents,
    ...components,
  };
}
