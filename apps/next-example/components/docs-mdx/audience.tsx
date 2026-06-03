import type { HTMLAttributes, ReactNode } from "react";

export type AudienceTarget = "agent" | "human";

export type AudienceProps = HTMLAttributes<HTMLDivElement> & {
  target: AudienceTarget;
  children?: ReactNode;
};

export function Audience({ target, children, ...rest }: AudienceProps) {
  if (target === "agent") {
    return null;
  }

  return (
    <div data-leadtype-audience={target} {...rest}>
      {children}
    </div>
  );
}
