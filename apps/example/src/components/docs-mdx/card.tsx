import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export type CardsProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

export function Cards({ children, ...rest }: CardsProps) {
  return (
    <div data-inth-cards="" {...rest}>
      {children}
    </div>
  );
}

export type CardVariant = "default" | "interactive";

export type CardProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
  /** Known variants autocomplete; arbitrary strings still type-check for forward compat. */
  variant?: CardVariant | (string & {});
  href?: string;
  children?: ReactNode;
};

export function Card({
  title,
  description,
  icon,
  variant,
  href,
  children,
  ...rest
}: CardProps) {
  const isExternal =
    href?.startsWith("http://") || href?.startsWith("https://");

  return (
    <a
      data-inth-card=""
      data-variant={variant ?? undefined}
      href={href}
      rel={isExternal ? "noopener" : undefined}
      target={isExternal ? "_blank" : undefined}
      {...rest}
    >
      {icon ? <span data-inth-card-icon="">{icon}</span> : null}
      {title ? <h3 data-inth-card-title="">{title}</h3> : null}
      {description ? <p data-inth-card-description="">{description}</p> : null}
      {children}
    </a>
  );
}
