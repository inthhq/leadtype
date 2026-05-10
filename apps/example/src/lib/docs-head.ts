import {
  type AgentReadabilityManifest,
  createDocsHead as createDocsHeadCore,
  type DocsHead,
} from "leadtype/llm/readability";
import agentReadability from "@/generated/agent-readability.json";

const manifest = agentReadability as AgentReadabilityManifest;

export function createDocsHead(urlPath: string): DocsHead {
  return createDocsHeadCore({ urlPath, manifest });
}
