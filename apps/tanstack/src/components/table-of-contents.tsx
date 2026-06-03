"use client";

import type { DocsTableOfContentsItem } from "leadtype/llm";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Separator } from "./ui/separator";

const HEADING_TOP_OFFSET = 104;
const ACTIVE_LINE_RATIO = 0.35;
const ACTIVE_LINE_MAX_OFFSET = 220;
const BOTTOM_SCROLL_TOLERANCE = 4;

interface TableOfContentsProps {
  items: DocsTableOfContentsItem[];
}

function flattenTocItems(
  items: DocsTableOfContentsItem[]
): DocsTableOfContentsItem[] {
  return items.flatMap((item) => [item, ...flattenTocItems(item.children)]);
}

function TocItems({
  activeId,
  onSelect,
  items,
  depth = 0,
}: {
  activeId?: string;
  onSelect: (id: string) => void;
  items: DocsTableOfContentsItem[];
  depth?: number;
}) {
  return (
    <ul className={cn("space-y-1", depth > 0 && "mt-1 pl-3")}>
      {items.map((item) => (
        <li key={item.urlWithHash}>
          <a
            aria-current={activeId === item.id ? "location" : undefined}
            className={cn(
              "relative block rounded-md px-2 py-1 text-muted-foreground text-sm leading-5 transition-all duration-200 hover:bg-secondary hover:text-foreground",
              "before:absolute before:inset-y-1 before:left-0 before:w-px before:origin-top before:scale-y-0 before:bg-foreground before:transition-transform before:duration-200",
              depth > 0 && "text-xs",
              activeId === item.id &&
                "translate-x-1 bg-secondary text-foreground before:scale-y-100"
            )}
            href={item.urlWithHash}
            onClick={() => {
              onSelect(item.id);
            }}
          >
            {item.title}
          </a>
          {item.children.length > 0 ? (
            <TocItems
              activeId={activeId}
              depth={depth + 1}
              items={item.children}
              onSelect={onSelect}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function TableOfContents({ items }: TableOfContentsProps) {
  const flatItems = useMemo(() => flattenTocItems(items), [items]);
  const [activeId, setActiveId] = useState<string | undefined>(
    flatItems[0]?.id
  );

  useEffect(() => {
    setActiveId(flatItems[0]?.id);
  }, [flatItems]);

  useEffect(() => {
    if (flatItems.length === 0) {
      return;
    }

    const headings = flatItems
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => Boolean(heading));

    const getActiveHeading = () => {
      const scrollBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight;

      if (pageBottom - scrollBottom <= BOTTOM_SCROLL_TOLERANCE) {
        return headings.at(-1);
      }

      const activeLine = Math.max(
        HEADING_TOP_OFFSET,
        Math.min(
          window.innerHeight * ACTIVE_LINE_RATIO,
          HEADING_TOP_OFFSET + ACTIVE_LINE_MAX_OFFSET
        )
      );

      let activeHeading = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= activeLine) {
          activeHeading = heading;
          continue;
        }

        break;
      }

      return activeHeading;
    };

    let animationFrame = 0;

    const updateActiveHeading = () => {
      animationFrame = 0;
      setActiveId(getActiveHeading()?.id);
    };

    const scheduleActiveHeadingUpdate = () => {
      if (animationFrame !== 0) {
        return;
      }

      animationFrame = window.requestAnimationFrame(updateActiveHeading);
    };

    const updateFromHash = () => {
      const rawHash = window.location.hash.slice(1);
      let hashId = rawHash;
      try {
        hashId = decodeURIComponent(rawHash);
      } catch {
        // malformed % sequence; fall back to the raw hash
      }
      const hashHeading = headings.find((heading) => heading.id === hashId);
      if (hashHeading) {
        setActiveId(hashHeading.id);
      }
      scheduleActiveHeadingUpdate();
    };

    updateFromHash();

    window.addEventListener("scroll", scheduleActiveHeadingUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleActiveHeadingUpdate);
    window.addEventListener("hashchange", updateFromHash);

    return () => {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("scroll", scheduleActiveHeadingUpdate);
      window.removeEventListener("resize", scheduleActiveHeadingUpdate);
      window.removeEventListener("hashchange", updateFromHash);
    };
  }, [flatItems]);

  if (items.length === 0) {
    return null;
  }

  return (
    <aside className="sticky top-[calc(var(--docs-anchor-offset-rem)+0.75rem)] hidden max-h-[calc(100svh-var(--docs-anchor-offset-rem)-1.5rem)] self-start overflow-y-auto lg:block">
      <nav aria-label="On this page" className="space-y-3">
        <h2 className="px-2 font-medium text-foreground text-xs uppercase tracking-wider">
          On this page
        </h2>
        <Separator />
        <TocItems activeId={activeId} items={items} onSelect={setActiveId} />
      </nav>
    </aside>
  );
}
