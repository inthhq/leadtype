import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export type AccordionProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

export function Accordion({ children, ...rest }: AccordionProps) {
  return (
    <div data-inth-accordion="" {...rest}>
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
    <details data-inth-accordion-item="" open={defaultOpen} {...rest}>
      <summary data-inth-accordion-summary="">{title}</summary>
      <div data-inth-accordion-content="">{children}</div>
    </details>
  );
}
