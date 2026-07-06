import { slugifyDocsHeading } from "leadtype/llm/readability";
import type { MDXComponents } from "mdx/types";
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  type MouseEvent,
} from "react";
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

async function copyHeadingUrl(
  event: MouseEvent<HTMLAnchorElement>,
  hash: string
): Promise<void> {
  if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
    event.preventDefault();
    history.replaceState(null, "", hash);
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }

  const url = new URL(window.location.href);
  url.hash = hash;
  await navigator.clipboard?.writeText(url.toString());
}

function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Heading = ({ children, className, id, ...props }: HeadingProps) => {
    const Component = `h${level}` as const;
    const headingText = textFromChildren(children);
    const headingId = id ?? slugifyDocsHeading(headingText);
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
          <a
            className="not-prose inline-flex items-baseline gap-2 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            data-docs-heading-anchor=""
            href={hash}
            onClick={(event) => {
              copyHeadingUrl(event, hash).catch(() => undefined);
            }}
            title="Copy link"
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
