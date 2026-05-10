import type { AnchorHTMLAttributes, HTMLAttributes } from "react";

export type TopicSwitcherItem = AnchorHTMLAttributes<HTMLAnchorElement> & {
  value: string;
  label: string;
  href: string;
  description?: string;
  current?: boolean;
};

export type TopicSwitcherProps = HTMLAttributes<HTMLElement> & {
  label?: string;
  activeValue?: string;
  items: TopicSwitcherItem[];
};

export function TopicSwitcher({
  label = "Topics",
  activeValue,
  items,
  ...rest
}: TopicSwitcherProps) {
  const hasDescriptions = items.some((item) => item.description);
  const variant = hasDescriptions ? "grid" : "segmented";

  return (
    <nav
      aria-label={label}
      data-leadtype-topic-switcher=""
      data-variant={variant}
      {...rest}
    >
      <p data-leadtype-topic-switcher-label="">{label}</p>
      <ul data-leadtype-topic-switcher-list="">
        {items.map(
          ({ value, label: itemLabel, description, current, ...item }) => {
            const isActive = current || value === activeValue;
            const href = item.href ?? "";
            const isExternal =
              href.startsWith("http://") || href.startsWith("https://");

            return (
              <li data-leadtype-topic-switcher-item="" key={value}>
                <a
                  aria-current={isActive ? "page" : undefined}
                  aria-disabled={href ? undefined : true}
                  data-active={isActive || undefined}
                  data-leadtype-topic-switcher-link=""
                  {...item}
                  href={href || undefined}
                  rel={isExternal ? "noopener" : item.rel}
                  target={isExternal ? "_blank" : item.target}
                >
                  <span data-leadtype-topic-switcher-item-label="">
                    {itemLabel}
                  </span>
                  {description ? (
                    <span data-leadtype-topic-switcher-item-description="">
                      {description}
                    </span>
                  ) : null}
                </a>
              </li>
            );
          }
        )}
      </ul>
    </nav>
  );
}
