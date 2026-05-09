import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export type AccordionProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

export function Accordion({ children, ...rest }: AccordionProps) {
  return (
    <div data-leadtype-accordion="" {...rest}>
      {children}
    </div>
  );
}

export type AccordionItemProps = DetailsHTMLAttributes<HTMLDetailsElement> & {
  title: string;
  defaultOpen?: boolean;
  children?: ReactNode;
};

export function AccordionItem({
  title,
  defaultOpen,
  children,
  ...rest
}: AccordionItemProps) {
  return (
    <details data-leadtype-accordion-item="" open={defaultOpen} {...rest}>
      <summary data-leadtype-accordion-summary="">{title}</summary>
      <div data-leadtype-accordion-content="">{children}</div>
    </details>
  );
}
