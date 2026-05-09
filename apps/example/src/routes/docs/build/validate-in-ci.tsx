"use client";

import { createFileRoute } from "@tanstack/react-router";
import ValidateInCiDoc from "../../../../../../docs/build/validate-in-ci.mdx";

export const Route = createFileRoute("/docs/build/validate-in-ci")({
  component: ValidateInCiRoute,
});

function ValidateInCiRoute() {
  return <ValidateInCiDoc />;
}
