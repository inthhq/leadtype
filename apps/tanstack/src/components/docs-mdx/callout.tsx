import type {
  CalloutTypeAlias,
  CalloutVariant,
  CalloutProps as LeadtypeCalloutProps,
} from "leadtype/mdx";
import type { HTMLAttributes, ReactNode } from "react";

export type { CalloutTypeAlias, CalloutVariant } from "leadtype/mdx";

export type CalloutProps = Omit<LeadtypeCalloutProps, "children"> &
  HTMLAttributes<HTMLElement> & {
    children?: ReactNode;
  };

function normalizeVariant(
  variant: CalloutVariant | undefined,
  type: CalloutTypeAlias | undefined
): CalloutVariant {
  if (variant) {
    return variant;
  }

  if (type === "warn") {
    return "warning";
  }

  return type ?? "info";
}

function titleCase(value: CalloutVariant): string {
  if (value === "canary") {
    return "Canary";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function Callout({
  variant,
  type,
  title,
  children,
  ...rest
}: CalloutProps) {
  const resolvedVariant = normalizeVariant(variant, type);

  return (
    <aside
      data-leadtype-callout=""
      data-variant={resolvedVariant}
      role="note"
      {...rest}
    >
      <p data-leadtype-callout-title="">
        <strong>{title ?? titleCase(resolvedVariant)}</strong>
      </p>
      <div data-leadtype-callout-content="">{children}</div>
    </aside>
  );
}
