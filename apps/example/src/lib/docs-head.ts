import {
  createDocsHead as createDocsHeadCore,
  type DocsHead,
  normalizeAgentReadabilityManifest,
} from "leadtype/llm/readability";
import agentReadability from "@/generated/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(agentReadability);

export function createDocsHead(urlPath: string): DocsHead {
  return createDocsHeadCore({ urlPath, manifest });
}
