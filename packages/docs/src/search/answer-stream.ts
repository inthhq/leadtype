const RESPONSE_INIT = {
  headers: {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  },
} as const satisfies ResponseInit;

export type PlainTextStreamHandlers<TPart> = {
  getError?: (part: TPart) => unknown;
  getFinishReason?: (part: TPart) => string | undefined;
  getText: (part: TPart) => string | undefined;
  isReasoning?: (part: TPart) => boolean;
};

export function getStreamErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "The AI provider returned an error while streaming.";
}

export function createDocsTextStreamResponse<TPart>(
  stream: AsyncIterable<TPart>,
  handlers: PlainTextStreamHandlers<TPart>,
  init: ResponseInit = RESPONSE_INIT
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let streamedText = false;
        let streamedFailure = false;
        let streamedReasoning = false;
        let finishReason = "";
        try {
          for await (const part of stream) {
            const text = handlers.getText(part);
            if (typeof text === "string" && text.length > 0) {
              streamedText = true;
              controller.enqueue(encoder.encode(text));
              continue;
            }

            if (handlers.isReasoning?.(part)) {
              streamedReasoning = true;
              continue;
            }

            const error = handlers.getError?.(part);
            if (error !== undefined) {
              streamedFailure = true;
              controller.enqueue(
                encoder.encode(
                  `AI answer failed: ${getStreamErrorMessage(error)}`
                )
              );
              break;
            }

            finishReason = handlers.getFinishReason?.(part) ?? finishReason;
          }

          if (!(streamedText || streamedFailure)) {
            const message =
              streamedReasoning && finishReason === "length"
                ? "AI answer failed: The model used the output budget for reasoning before producing an answer. Increase maxOutputTokens or use a non-reasoning model."
                : "AI answer failed: The AI provider returned an empty answer. Check gateway auth and model access.";
            controller.enqueue(encoder.encode(message));
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(`AI answer failed: ${getStreamErrorMessage(error)}`)
          );
        } finally {
          controller.close();
        }
      },
    }),
    init
  );
}

export function getPlainTextResponseInit(): ResponseInit {
  return RESPONSE_INIT;
}
