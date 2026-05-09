Add `Accept: text/markdown` content negotiation to this Vite docs app so coding agents can fetch the `.md` version of any page from the same URL humans visit at HTML.

Specifically:

1. Add a Vite plugin in `vite.config.ts` that, for any request under `/docs/*` with `Accept: text/markdown`, rewrites the URL to the `.md` file. Browsers (which send `text/html,*/*`) must keep getting HTML.
2. Make sure the response advertises `Content-Type: text/markdown; charset=utf-8` — otherwise UTF-8 box-drawing characters and em dashes render as mojibake.
3. Verify with `curl -I -H "Accept: text/markdown" http://localhost:5173/docs/quickstart` — the response should be `text/markdown; charset=utf-8`.

A `leadtype` package is already installed. Use whatever resources it provides if helpful.
