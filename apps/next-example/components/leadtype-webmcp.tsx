"use client";

import { createDocsWebMcpTools, registerWebMcpTools } from "leadtype/webmcp";
import { useEffect } from "react";

export function LeadtypeWebMcp() {
  useEffect(() => {
    const registration = registerWebMcpTools(createDocsWebMcpTools());
    return () => {
      registration.unregister();
    };
  }, []);

  return null;
}
