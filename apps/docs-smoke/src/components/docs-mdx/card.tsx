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

export type CardProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  title?: string;
  description?: string;
  href?: string;
  children?: ReactNode;
};

export function Card({
  title,
  description,
  href,
  children,
  ...rest
}: CardProps) {
  const isExternal =
    href?.startsWith("http://") || href?.startsWith("https://");

  return (
    <a
      data-inth-card=""
      href={href}
      rel={isExternal ? "noopener" : undefined}
      target={isExternal ? "_blank" : undefined}
      {...rest}
    >
      {title ? <h3 data-inth-card-title="">{title}</h3> : null}
      {description ? <p data-inth-card-description="">{description}</p> : null}
      {children}
    </a>
  );
}
