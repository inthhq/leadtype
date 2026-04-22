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
  return (
    <nav aria-label={label} data-inth-topic-switcher="" {...rest}>
      <p data-inth-topic-switcher-label="">{label}</p>
      <ul data-inth-topic-switcher-list="">
        {items.map(
          ({ value, label: itemLabel, description, current, ...item }) => {
            const isActive = current || value === activeValue;
            const href = item.href ?? "";
            const isExternal =
              href.startsWith("http://") || href.startsWith("https://");

            return (
              <li data-inth-topic-switcher-item="" key={value}>
                <a
                  aria-current={isActive ? "page" : undefined}
                  aria-disabled={href ? undefined : true}
                  data-active={isActive || undefined}
                  data-inth-topic-switcher-link=""
                  {...item}
                  href={href || undefined}
                  rel={isExternal ? "noopener" : item.rel}
                  target={isExternal ? "_blank" : item.target}
                >
                  <span data-inth-topic-switcher-item-label="">
                    {itemLabel}
                  </span>
                  {description ? (
                    <span data-inth-topic-switcher-item-description="">
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
