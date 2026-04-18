import type { HTMLAttributes, ReactNode } from "react";

export type StepsProps = HTMLAttributes<HTMLOListElement> & {
  children?: ReactNode;
};

export function Steps({ children, ...rest }: StepsProps) {
  return (
    <ol data-inth-steps="" {...rest}>
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
    <li data-inth-step="" {...rest}>
      {title ? <h4 data-inth-step-title="">{title}</h4> : null}
      <div data-inth-step-content="">{children}</div>
    </li>
  );
}
