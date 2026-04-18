import type { HTMLAttributes, ReactNode } from "react";

export type CalloutVariant =
  | "info"
  | "warning"
  | "success"
  | "error"
  | "canary"
  | "deprecated"
  | "experimental";

export type CalloutProps = HTMLAttributes<HTMLElement> & {
  variant?: CalloutVariant;
  title?: string;
  children?: ReactNode;
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function Callout({
  variant = "info",
  title,
  children,
  ...rest
}: CalloutProps) {
  return (
    <aside data-inth-callout="" data-variant={variant} role="note" {...rest}>
      <p data-inth-callout-title="">
        <strong>{title ?? titleCase(variant)}</strong>
      </p>
      <div data-inth-callout-content="">{children}</div>
    </aside>
  );
}
