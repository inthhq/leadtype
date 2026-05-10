import type { AnyTextAdapter, StreamChunk } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import { createDocsSearchIndex, type DocsSearchDocument } from "./index";
import { streamDocsAnswer } from "./tanstack-index";

const docs: DocsSearchDocument[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    description: "Install and configure the package.",
    urlPath: "/docs/guides/quickstart",
    absoluteUrl: "https://leadtype.dev/docs/guides/quickstart",
    relativePath: "guides/quickstart",
    content:
      "# Quickstart\n\n## Install\n\nUse tabs to pick a package manager.",
  },
];

const adapter = {} as AnyTextAdapter;

describe("TanStack streamDocsAnswer", () => {
  it("passes grounded prompt settings into chat", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { content, ...metadataOnlyIndex } = index;
    if (!content) {
      throw new Error("Expected createDocsSearchIndex to embed content.");
    }
    const calls: unknown[] = [];
    const tools = [{ name: "docs_bash", description: "Inspect docs" }];

    const result = streamDocsAnswer({
      adapter,
      content,
      index: metadataOnlyIndex,
      maxTokens: 123,
      productName: "leadtype",
      query: "How do tabs work?",
      toolInstructions: "Use tools only for docs inspection.",
      tools,
      chatImpl: (options) => {
        calls.push(options);
        return (async function* () {
          yield {
            delta: "answer",
            type: "TEXT_MESSAGE_CONTENT",
          } as StreamChunk;
        })();
      },
    });

    expect(result.sources[0]?.title).toBe("Quickstart");
    await expect(result.response.text()).resolves.toBe("answer");

    const call = calls[0] as {
      maxTokens: number;
      messages: Array<{ content: string; role: string }>;
      systemPrompts: string[];
      tools: unknown[];
    };
    expect(call.maxTokens).toBe(123);
    expect(call.messages[0]?.content).toContain("How do tabs work?");
    expect(call.messages[0]?.content).toContain("[1]");
    expect(call.systemPrompts[0]).toContain(
      "Use only the provided documentation context"
    );
    expect(call.systemPrompts[0]).toContain(
      "Use tools only for docs inspection."
    );
    expect(call.tools).toBe(tools);
  });

  it("streams provider errors as visible text", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = streamDocsAnswer({
      adapter,
      index,
      query: "How do tabs work?",
      chatImpl: () =>
        (async function* () {
          yield {
            message: "model is unavailable",
            type: "RUN_ERROR",
          } as StreamChunk;
        })(),
    });

    await expect(result.response.text()).resolves.toContain(
      "AI answer failed: model is unavailable"
    );
  });

  it("streams empty provider responses as visible text", async () => {
    const index = createDocsSearchIndex(docs, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = streamDocsAnswer({
      adapter,
      index,
      query: "How do tabs work?",
      chatImpl: () =>
        (async function* () {
          yield* [];
        })(),
    });

    await expect(result.response.text()).resolves.toContain(
      "AI answer failed: The AI provider returned an empty answer."
    );
  });
});
