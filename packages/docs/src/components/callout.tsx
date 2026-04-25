import type { HTMLAttributes, ReactNode } from "react";
import {
  type CalloutTypeAlias,
  type CalloutVariant,
  calloutTitleCase,
  normalizeCalloutVariant,
} from "../internal/callout-variant";

export type {
  CalloutTypeAlias,
  CalloutVariant,
} from "../internal/callout-variant";

export type CalloutProps = HTMLAttributes<HTMLElement> & {
  variant?: CalloutVariant;
  /** @deprecated Use `variant` instead. Kept for Fumadocs-authored MDX compatibility. */
  type?: CalloutTypeAlias;
  title?: string;
  children?: ReactNode;
};

export function Callout({
  variant,
  type,
  title,
  children,
  ...rest
}: CalloutProps) {
  const resolvedVariant = normalizeCalloutVariant(variant, type);

  return (
    <aside
      data-inth-callout=""
      data-variant={resolvedVariant}
      role="note"
      {...rest}
    >
      <p data-inth-callout-title="">
        <strong>{title ?? calloutTitleCase(resolvedVariant)}</strong>
      </p>
      <div data-inth-callout-content="">{children}</div>
    </aside>
  );
}
