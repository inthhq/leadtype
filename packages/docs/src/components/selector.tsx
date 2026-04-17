"use client";

import { type ReactNode, useId, useState } from "react";

export type SelectorOption = {
  value: string;
  label: string;
};

export type SelectorProps = {
  label?: string;
  options: SelectorOption[];
  defaultValue?: string;
  children?: (activeValue: string) => ReactNode;
};

/**
 * Minimal dropdown-style selector. Consumers typically replace this with
 * their own styled version — the default just renders a native `<select>`
 * plus whatever the render-prop child returns for the active value.
 */
export function Selector({
  label,
  options,
  defaultValue,
  children,
}: SelectorProps) {
  const [activeValue, setActiveValue] = useState(
    defaultValue ?? options[0]?.value ?? ""
  );
  const id = useId();

  return (
    <div data-inth-selector="">
      {label ? (
        <label data-inth-selector-label="" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <select
        data-inth-selector-control=""
        id={id}
        onChange={(event) => setActiveValue(event.target.value)}
        value={activeValue}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div data-inth-selector-content="" data-value={activeValue}>
        {children ? children(activeValue) : null}
      </div>
    </div>
  );
}
