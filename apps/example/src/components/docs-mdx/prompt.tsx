"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useRef, useState } from "react";

const COPIED_TIMEOUT_MS = 1500;

export type PromptProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  children?: ReactNode;
};

export function Prompt({
  title = "Prompt",
  description,
  children,
  ...rest
}: PromptProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  function copyPrompt() {
    const text = contentRef.current?.innerText.trim();
    if (!text) {
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
      })
      .catch(() => {
        setCopied(false);
      });
  }

  return (
    <div data-leadtype-prompt="" {...rest}>
      <div data-leadtype-prompt-header="">
        <div>
          <h3 data-leadtype-prompt-title="">{title}</h3>
          {description ? (
            <p data-leadtype-prompt-description="">{description}</p>
          ) : null}
        </div>
        <button data-leadtype-prompt-copy="" onClick={copyPrompt} type="button">
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>
      <div data-leadtype-prompt-content="" ref={contentRef}>
        {children}
      </div>
    </div>
  );
}
