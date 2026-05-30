import type { Provider } from "./transcript";

/**
 * Normalize a bare model id to a gateway-namespaced id. Ids that already
 * carry a provider prefix (contain "/") pass through untouched. Otherwise we
 * route by family: `gpt-`/`o1`/`o3` → openai, `gemini` → google, everything
 * else → anthropic. The harness only ever talks to the Vercel AI Gateway, so
 * one key brokers all three providers.
 */
export function namespaceModelId(modelId: string): string {
  if (modelId.includes("/")) {
    return modelId;
  }
  if (/^(gpt-|o1|o3|o4)/.test(modelId)) {
    return `openai/${modelId}`;
  }
  if (modelId.startsWith("gemini")) {
    return `google/${modelId}`;
  }
  return `anthropic/${modelId}`;
}

export function providerFor(modelId: string): Provider {
  const namespaced = namespaceModelId(modelId);
  if (namespaced.startsWith("openai/")) {
    return "openai";
  }
  if (namespaced.startsWith("google/")) {
    return "google";
  }
  return "anthropic";
}

/** Parse a comma-separated `--models` list into trimmed, de-duped ids. */
export function parseModelList(value: string): string[] {
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return [...new Set(ids)];
}
