/**
 * Runtime-safe redirect primitives. This entry point is what route handlers
 * import for `resolveRedirect`, so it must stay free of Node-only modules —
 * it runs in edge runtimes (Cloudflare Workers, Vercel Edge, …). Generate-time
 * lockfile IO and hashing live under `leadtype/redirects/node`.
 */
export {
  type ComputeDocsRedirectsInput,
  type ComputeDocsRedirectsResult,
  computeDocsRedirects,
  type DocsPathsLockfile,
  type DocsPathsLockfilePage,
  type DocsRedirect,
  normalizeRedirectPath,
  REDIRECT_STATUS_GONE,
  REDIRECT_STATUS_MOVED,
  type RedirectPageInput,
  resolveRedirect,
} from "./redirects";
