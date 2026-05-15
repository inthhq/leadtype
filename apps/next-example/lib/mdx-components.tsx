import type { ReactNode } from "react";

export const mdxComponents = {
  Callout: ({
    title,
    children,
  }: {
    title?: string;
    variant?: string;
    children?: ReactNode;
  }) => (
    <aside className="callout">
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </aside>
  ),
  Steps: ({ children }: { children?: ReactNode }) => <ol>{children}</ol>,
  Step: ({ title, children }: { title?: string; children?: ReactNode }) => (
    <li>
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </li>
  ),
  Tabs: ({ children }: { items?: string[]; children?: ReactNode }) => (
    <div className="tabs">{children}</div>
  ),
  Tab: ({ value, children }: { value?: string; children?: ReactNode }) => (
    <section>
      {value ? <h3>{value}</h3> : null}
      {children}
    </section>
  ),
};
