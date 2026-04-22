/**
 * Cloudflare AI Gateway / Workers AI adapter helpers and docs bash tools.
 *
 * @packageDocumentation
 */
export {
  type CloudflareDocsProvider,
  type CreateCloudflareDocsAdapterOptions,
  createCloudflareDocsAdapter,
  type StreamDocsAnswerOptions,
  type StreamDocsAnswerResult,
  streamDocsAnswer,
} from "./cloudflare";
export {
  type CreateDocsBashToolsOptions,
  createDocsBashTools,
  type DocsTanStackBashResult,
} from "./tanstack-bash";
