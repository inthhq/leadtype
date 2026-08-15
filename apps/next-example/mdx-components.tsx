import {
  createDocsHeadingSlugger,
  type DocsHeadingSlugger,
} from "leadtype/llm/readability";
import type { MDXComponents } from "mdx/types";
import { type ComponentPropsWithoutRef, isValidElement } from "react";
import { mdxComponents } from "@/components/docs-mdx";
import { cn } from "@/lib/utils";

type HeadingProps = ComponentPropsWithoutRef<"h1">;

function textFromChildren(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  if (isValidElement(children)) {
    const elementProps = children.props as { children?: unknown };
    return textFromChildren(elementProps.children);
  }
  return "";
}

function createHeading(
  level: 1 | 2 | 3 | 4 | 5 | 6,
  slugger: DocsHeadingSlugger
) {
  const Heading = ({ children, className, id, ...props }: HeadingProps) => {
    const Component = `h${level}` as const;
    const headingText = textFromChildren(children);
    const headingId = id ?? slugger.slug(headingText);
    const hash = headingId ? `#${headingId}` : undefined;

    return (
      <Component
        className={cn(
          "group scroll-mt-[var(--docs-anchor-offset-rem)]",
          className
        )}
        id={headingId || undefined}
        {...props}
      >
        {hash ? (
          // RSC-safe anchor: native hash navigation, no client click handler.
          <a
            className="not-prose inline-flex items-baseline gap-2 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            data-docs-heading-anchor=""
            href={hash}
          >
            <span>{children}</span>
            <span
              aria-hidden="true"
              className="inline-flex size-5 translate-y-[-0.08em] items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-foreground group-hover:opacity-100"
            >
              #
            </span>
          </a>
        ) : (
          children
        )}
      </Component>
    );
  };

  return Heading;
}

function createMdxHeadingComponents(): MDXComponents {
  const slugger = createDocsHeadingSlugger();
  return {
    h1: createHeading(1, slugger),
    h2: createHeading(2, slugger),
    h3: createHeading(3, slugger),
    h4: createHeading(4, slugger),
    h5: createHeading(5, slugger),
    h6: createHeading(6, slugger),
  };
}

export function useMDXComponents(
  components: MDXComponents = {}
): MDXComponents {
  return {
    ...createMdxHeadingComponents(),
    ...mdxComponents,
    ...components,
  };
}
