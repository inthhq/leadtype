import { describe, expect, it } from "vitest";

describe("Cloudflare docs adapter", () => {
  it("maps providers to explicit Cloudflare adapters", async () => {
    const { createCloudflareDocsAdapter } = await import("./cloudflare-index");
    const options = { binding: {} };

    expect(
      createCloudflareDocsAdapter({
        model: "gpt-4o",
        options,
        provider: "openai",
      })
    ).toMatchObject({ name: "openai" });

    expect(
      createCloudflareDocsAdapter({
        model: "@cf/meta/llama-3.1-8b-instruct",
        options,
        provider: "workers-ai",
      })
    ).toMatchObject({ name: "workers-ai" });
  });
});
