# Set up agent-ready docs with leadtype

Use leadtype to turn an existing MDX/Markdown docs source into a site that AI agents can discover, fetch, attribute, and cite — `llms.txt`, per-page Markdown mirrors, JSON-LD, `robots.txt` with Content-Signals, an agent-skills surface, and an optional docs MCP server. leadtype is additive: it generates files and ships runtime primitives; it never renders UI or owns your server.

## Steps

1. **Install.** `npm i leadtype` (or `bun add leadtype`). The MCP server needs `@modelcontextprotocol/sdk` — add it only if you serve MCP.

2. **Write `docs.config.ts`.** One source of truth for the site and every agent artifact:

   ```ts
   import { defineDocsConfig } from "leadtype";

   export default defineDocsConfig({
     // Identity — reused across llms.txt, JSON-LD, and the agent card.
     product: { name: "Acme", tagline: "One sentence about the product." },
     // Who publishes it → JSON-LD Organization + agent-card provider.
     organization: { name: "Acme Inc", url: "https://acme.com" },
     navigation: [{ title: "Start", slug: "start", pages: ["/docs/quickstart"] }],
     agents: {
       robots: { policy: "balanced" }, // balanced · open · block-training · block-ai
       seo: { keywords: ["docs", "api"] },
       mcp: { enabled: true }, // only if you host a docs MCP endpoint
     },
   });
   ```

   `name` + `tagline` are the only required fields. Everything else is optional — omit `organization`/`agents` and you still get balanced robots, the JSON-LD graph, per-page metadata, the auto docs-skill, and an agent card. Add keys only to change a default.

3. **Generate.** Run before your app build:

   ```bash
   npx leadtype generate --src . --out public \
     --base-url https://acme.dev --name "Acme" --summary "…"
   ```

   This writes `public/llms.txt`, `public/llms-full.txt`, `public/docs/*.md` mirrors, sitemaps, `robots.txt`, `agent-readability.json`, and the `/.well-known/agent-skills` + `agent-card.json` surface.

4. **Serve at runtime.** Load `agent-readability.json` once and pass it to leadtype's runtime helpers to negotiate Markdown responses for agent requests, inject JSON-LD into HTML heads, and serve sitemap/robots from the live origin. The helpers are framework-neutral (they take a Web `Request`/`Response`).

5. **Verify.** `npx leadtype score` (0–100 against the ora rubric), `npx leadtype lint docs` (GEO + JSON-LD checks), and `npx leadtype mcp --check` if MCP is enabled. Spot-check the URLs agents use:

   ```bash
   curl https://acme.dev/llms.txt
   curl -H "Accept: text/markdown" https://acme.dev/docs/quickstart
   curl https://acme.dev/.well-known/agent-card.json
   ```

## Notes

- Write docs for agents by documenting the **non-obvious** — gotchas, constraints, why — not restatements of types or CLI help. That's the single change that moved the repo's agent evals most.
- `robots` `Disallow` is advisory; pair `block-*` policies with a CDN/WAF for hard enforcement.
- To bundle docs inside an npm package instead of a site, use `leadtype generate --bundle`, which emits `AGENTS.md` + `docs/` + a single offline-pointing `SKILL.md` into the package.
