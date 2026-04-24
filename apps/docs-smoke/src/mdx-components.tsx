import { slugifyDocsHeading } from "@inth/docs/search";
import type { MDXComponents } from "mdx/types";
import type { ComponentPropsWithoutRef } from "react";
import { mdxComponents } from "@/components/docs-mdx";

type HeadingProps = ComponentPropsWithoutRef<"h1">;

function textFromChildren(children: HeadingProps["children"]): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join(" ");
  }
  return "";
}

function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Heading = ({ children, id, ...props }: HeadingProps) => {
    const Component = `h${level}` as const;
    const headingId = id ?? slugifyDocsHeading(textFromChildren(children));

    return (
      <Component id={headingId || undefined} {...props}>
        {children}
      </Component>
    );
  };

  return Heading;
}

export function useMDXComponents(
  components: MDXComponents = {}
): MDXComponents {
  return {
    h1: createHeading(1),
    h2: createHeading(2),
    h3: createHeading(3),
    h4: createHeading(4),
    h5: createHeading(5),
    h6: createHeading(6),
    ...mdxComponents,
    ...components,
  };
}
