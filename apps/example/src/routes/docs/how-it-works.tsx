"use client";

import { createFileRoute } from "@tanstack/react-router";
import HowItWorksDoc from "../../../../../docs/how-it-works.mdx";

export const Route = createFileRoute("/docs/how-it-works")({
  component: HowItWorksRoute,
});

function HowItWorksRoute() {
  return <HowItWorksDoc />;
}
