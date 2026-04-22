import { describe, expect, it } from "vitest";
import {
  createDocsTextStreamResponse,
  getPlainTextResponseInit,
} from "./answer-stream";

async function readResponseText(response: Response): Promise<string> {
  return response.text();
}

describe("answer stream helpers", () => {
  it("returns fresh plain-text response init objects", () => {
    const first = getPlainTextResponseInit();
    const second = getPlainTextResponseInit();

    expect(first).not.toBe(second);
    expect(first.headers).not.toBe(second.headers);

    const headers = first.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (headers instanceof Headers) {
      headers.set("Cache-Control", "public");
    }

    expect(new Headers(second.headers).get("Cache-Control")).toBe("no-store");
  });

  it("records finish metadata on reasoning chunks before skipping text", async () => {
    const response = createDocsTextStreamResponse(
      [
        {
          finishReason: "length",
          text: "hidden reasoning",
          type: "reasoning",
        },
      ],
      {
        getFinishReason: (part) => part.finishReason,
        getText: (part) => part.text,
        isReasoning: (part) => part.type === "reasoning",
      }
    );

    await expect(readResponseText(response)).resolves.toBe(
      "AI answer failed: The model used the output budget for reasoning before producing an answer. Increase maxOutputTokens or use a non-reasoning model."
    );
  });
});
