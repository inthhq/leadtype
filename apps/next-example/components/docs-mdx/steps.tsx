import type { HTMLAttributes, ReactNode } from "react";

export type StepsProps = HTMLAttributes<HTMLOListElement> & {
  children?: ReactNode;
};

export function Steps({ children, ...rest }: StepsProps) {
  return (
    <ol data-leadtype-steps="" {...rest}>
      {children}
    </ol>
  );
}

export type StepProps = HTMLAttributes<HTMLLIElement> & {
  title?: string;
  children?: ReactNode;
};

export function Step({ title, children, ...rest }: StepProps) {
  return (
    <li data-leadtype-step="" {...rest}>
      {title ? <h4 data-leadtype-step-title="">{title}</h4> : null}
      <div data-leadtype-step-content="">{children}</div>
    </li>
  );
}
