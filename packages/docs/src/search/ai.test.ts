import { describe, expect, it } from "vitest";
import { streamDocsAnswer } from "./ai-index";
import { createSearchIndex, type DocsSearchDocument } from "./index";

const docs: DocsSearchDocument[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    description: "Install and configure the package.",
    urlPath: "/docs/guides/quickstart",
    absoluteUrl: "https://docs.example.com/docs/guides/quickstart",
    relativePath: "guides/quickstart",
    content:
      "# Quickstart\n\n## Install\n\nUse tabs to pick a package manager.",
  },
];

describe("streamDocsAnswer", () => {
  it("passes grounded prompt settings into streamText", async () => {
    const index = createSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createSearchIndex to embed content.");
    }
    const calls: unknown[] = [];

    const result = streamDocsAnswer({
      index: metadataOnlyIndex,
      content,
      query: "How do tabs work?",
      model: "openai/gpt-5.4-mini",
      productName: "@inth/docs",
      maxOutputTokens: 123,
      timeout: { totalMs: 1000, chunkMs: 500 },
      streamTextImpl: (options) => {
        calls.push(options);
        return {
          toTextStreamResponse: () => new Response("answer"),
        };
      },
    });

    expect(result.sources[0]?.title).toBe("Quickstart");
    await expect(result.response.text()).resolves.toBe("answer");

    const call = calls[0] as {
      maxOutputTokens: number;
      model: string;
      prompt: string;
      system: string;
      timeout: { totalMs: number; chunkMs: number };
    };
    expect(call.model).toBe("openai/gpt-5.4-mini");
    expect(call.maxOutputTokens).toBe(123);
    expect(call.timeout).toEqual({ totalMs: 1000, chunkMs: 500 });
    expect(call.system).toContain(
      "Use only the provided documentation context"
    );
    expect(call.prompt).toContain("How do tabs work?");
    expect(call.prompt).toContain("[1]");
  });

  it("streams provider errors as visible text", async () => {
    const index = createSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createSearchIndex to embed content.");
    }

    const result = streamDocsAnswer({
      index: metadataOnlyIndex,
      content,
      query: "How do tabs work?",
      streamTextImpl: () => ({
        fullStream: (async function* () {
          yield {
            error: new Error("model is unavailable"),
            type: "error",
          };
        })(),
        toTextStreamResponse: () => new Response(""),
      }),
    });

    await expect(result.response.text()).resolves.toContain(
      "AI answer failed: model is unavailable"
    );
  });

  it("streams empty provider responses as visible text", async () => {
    const index = createSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createSearchIndex to embed content.");
    }

    const result = streamDocsAnswer({
      index: metadataOnlyIndex,
      content,
      query: "How do tabs work?",
      streamTextImpl: () => ({
        fullStream: (async function* () {
          yield* [];
        })(),
        toTextStreamResponse: () => new Response(""),
      }),
    });

    await expect(result.response.text()).resolves.toContain(
      "AI answer failed: The AI provider returned an empty answer."
    );
  });

  it("explains when reasoning consumes the output budget", async () => {
    const index = createSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createSearchIndex to embed content.");
    }

    const result = streamDocsAnswer({
      index: metadataOnlyIndex,
      content,
      query: "How do tabs work?",
      streamTextImpl: () => ({
        fullStream: (async function* () {
          yield {
            text: "thinking",
            type: "reasoning-delta",
          };
          yield {
            finishReason: "length",
            type: "finish",
          };
        })(),
        toTextStreamResponse: () => new Response(""),
      }),
    });

    await expect(result.response.text()).resolves.toContain(
      "used the output budget for reasoning"
    );
  });
});
