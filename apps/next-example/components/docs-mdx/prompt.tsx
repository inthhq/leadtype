"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const COPIED_TIMEOUT_MS = 1500;
const COLLAPSED_HEIGHT_PX = 72;
const OVERFLOW_THRESHOLD_PX = 4;

function SparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      data-leadtype-prompt-icon=""
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
    >
      <path
        d="M8 1.5 9.4 5.6a2 2 0 0 0 1 1L14.5 8l-4.1 1.4a2 2 0 0 0-1 1L8 14.5 6.6 10.4a2 2 0 0 0-1-1L1.5 8l4.1-1.4a2 2 0 0 0 1-1L8 1.5Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
    >
      <rect
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
        width="9"
        x="5.5"
        y="5.5"
      />
      <path
        d="M3.5 10.5h-.25a.75.75 0 0 1-.75-.75v-7a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 .75.75v.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
    >
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      data-leadtype-prompt-toggle-icon=""
      fill="none"
      height="12"
      viewBox="0 0 16 16"
      width="12"
    >
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

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
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const update = () => {
      setOverflows(
        el.scrollHeight > COLLAPSED_HEIGHT_PX + OVERFLOW_THRESHOLD_PX
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function copyPrompt() {
    const text = contentRef.current?.innerText.trim();
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
    } catch {
      setCopied(false);
    }
  }

  function handleCopyClick() {
    copyPrompt().catch(() => {
      setCopied(false);
    });
  }

  const isExpanded = expanded || !overflows;

  return (
    <div
      data-expanded={isExpanded || undefined}
      data-leadtype-prompt=""
      {...rest}
    >
      <div data-leadtype-prompt-header="">
        <div data-leadtype-prompt-meta="">
          <SparkleIcon />
          <div data-leadtype-prompt-text="">
            <h3 data-leadtype-prompt-title="">{title}</h3>
            {description ? (
              <p data-leadtype-prompt-description="">{description}</p>
            ) : null}
          </div>
        </div>
        <button
          aria-label={copied ? "Copied to clipboard" : "Copy prompt"}
          data-copied={copied || undefined}
          data-leadtype-prompt-copy=""
          onClick={handleCopyClick}
          type="button"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span data-leadtype-prompt-copy-label="">
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>
      <div data-leadtype-prompt-body="">
        <div data-leadtype-prompt-content="" ref={contentRef}>
          {children}
        </div>
      </div>
      {overflows ? (
        <button
          aria-expanded={isExpanded}
          data-leadtype-prompt-toggle=""
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <span>{isExpanded ? "Show less" : "Show prompt"}</span>
          <ChevronDownIcon />
        </button>
      ) : null}
    </div>
  );
}
