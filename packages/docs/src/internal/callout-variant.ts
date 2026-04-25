// Pure variant resolution for the Callout component. Lives in `internal/`
// so it can be unit-tested without rendering React.

export type CalloutVariant =
  | "info"
  | "note"
  | "tip"
  | "warning"
  | "success"
  | "error"
  | "canary"
  | "deprecated"
  | "experimental";

/**
 * Aliases accepted by the deprecated `type` prop. Mirrors `CalloutVariant`
 * but also accepts `"warn"` (Fumadocs-style) which maps to `"warning"`.
 */
export type CalloutTypeAlias = CalloutVariant | "warn";

export function normalizeCalloutVariant(
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

export function calloutTitleCase(value: CalloutVariant): string {
  if (value === "canary") {
    return "Canary";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}
