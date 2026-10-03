"use client";

import { useEffect, useRef } from "react";
import {
  type RegisterDocsWebMcpToolsOptions,
  registerDocsWebMcpTools,
} from "./index.js";

/**
 * Register the generated docs as browser WebMCP tools for the lifetime of the
 * component. Options are captured on mount; later changes are ignored.
 *
 * @example
 * ```tsx
 * "use client";
 *
 * export function LeadtypeWebMcp() {
 *   useLeadtypeWebMcp();
 *   return null;
 * }
 * ```
 */
export function useLeadtypeWebMcp(
  options: RegisterDocsWebMcpToolsOptions = {}
): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    const registration = registerDocsWebMcpTools(optionsRef.current);
    return () => {
      registration.unregister();
    };
  }, []);
}
