import { describe, expect, it } from "vitest";
import { validateDocsConfig } from "./load";

const CONFIG_PATH = "/site/leadtype.config.ts";

function withApis(apis: unknown): unknown {
  return {
    product: { name: "Leadtype", tagline: "Docs pipeline." },
    agents: { apis },
  };
}

describe("agents.apis config validation", () => {
  it("accepts typed API entries with per-API link metadata", () => {
    const config = validateDocsConfig(
      withApis([
        {
          href: "/ask",
          title: "Documentation query API",
          type: "application/json",
          version: "1.0",
          serviceDesc: {
            href: "/openapi.json",
            type: "application/vnd.oai.openapi+json;version=3.1",
          },
          serviceDoc: [
            { href: "/docs/reference/nlweb", type: "text/html" },
            { href: "https://partner.example/docs", title: "Partner guide" },
          ],
          serviceMeta: { href: "/docs/agent-readability.json" },
          status: { href: "https://status.leadtype.dev" },
        },
        { href: "https://api.leadtype.dev/v1/search" },
      ]),
      CONFIG_PATH
    );

    expect(config.agents?.apis).toHaveLength(2);
    expect(config.agents?.apis?.[1]?.href).toBe(
      "https://api.leadtype.dev/v1/search"
    );
  });

  it("leaves the catalog unconfigured when no APIs are declared", () => {
    const config = validateDocsConfig(
      {
        product: { name: "Leadtype", tagline: "Docs pipeline." },
        agents: { nlweb: { endpoint: "/ask" } },
      },
      CONFIG_PATH
    );

    expect(config.agents).toBeDefined();
    expect(config.agents?.apis).toBeUndefined();
  });

  it("rejects malformed product documentation URLs at config load", () => {
    expect(() =>
      validateDocsConfig(
        {
          product: {
            name: "Leadtype",
            tagline: "Docs pipeline.",
            docs: "/docs%",
          },
        },
        CONFIG_PATH
      )
    ).toThrow(/product\.docs must not contain a malformed percent escape/);
  });

  it("rejects malformed API entries at load rather than at generate", () => {
    expect(() =>
      validateDocsConfig(withApis({ href: "/ask" }), CONFIG_PATH)
    ).toThrow(/agents\.apis must be an array/);
    expect(() =>
      validateDocsConfig(withApis([{ title: "No href" }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must be an object with a non-empty href/);
    expect(() =>
      validateDocsConfig(withApis([{ href: "   " }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must be an object with a non-empty href/);
    expect(() =>
      validateDocsConfig(withApis([{ href: "https://[" }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must have a valid href/);
    for (const href of [
      "https:api.example/v1",
      "ws:api.example/socket",
      "wss:/api.example/socket",
      "ftp:api.example/file",
      "file:relative/path",
    ]) {
      expect(() =>
        validateDocsConfig(withApis([{ href }]), CONFIG_PATH)
      ).toThrow(
        /agents\.apis\[0\] must use the required slashes after its URL scheme/
      );
    }
    expect(() =>
      validateDocsConfig(
        withApis([{ href: "file:/absolute/path" }]),
        CONFIG_PATH
      )
    ).not.toThrow();
    expect(() =>
      validateDocsConfig(withApis([{ href: "/api%ZZ" }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must not contain a malformed percent escape/);
    expect(() =>
      validateDocsConfig(withApis([{ href: "/api\nx" }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must not contain ASCII control characters/);
    expect(() =>
      validateDocsConfig(withApis([{ href: "/api\uD800v1" }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must not contain unpaired UTF-16 surrogates/);
    expect(() =>
      validateDocsConfig(withApis([{ href: "/api\uD800" }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must not contain unpaired UTF-16 surrogates/);
    expect(() =>
      validateDocsConfig(withApis([{ href: "/api\\v1" }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\] must not contain backslashes/);
    expect(() =>
      validateDocsConfig(withApis([{ href: "/ask", version: 1 }]), CONFIG_PATH)
    ).toThrow(/agents\.apis\[0\]\.version must be a string/);
    expect(() =>
      validateDocsConfig(
        withApis([{ href: "/ask", type: "not a media type" }]),
        CONFIG_PATH
      )
    ).toThrow(/agents\.apis\[0\]\.type must be a valid ASCII media type/);
    expect(() =>
      validateDocsConfig(
        withApis([{ href: "/ask", serviceDesc: { type: "application/json" } }]),
        CONFIG_PATH
      )
    ).toThrow(/agents\.apis\[0\]\.serviceDesc must be a link/);
    expect(() =>
      validateDocsConfig(
        withApis([{ href: "/ask", serviceDesc: { href: "\t" } }]),
        CONFIG_PATH
      )
    ).toThrow(/agents\.apis\[0\]\.serviceDesc must be a link/);
    expect(() =>
      validateDocsConfig(
        withApis([{ href: "/ask", serviceDesc: { href: "https://[" } }]),
        CONFIG_PATH
      )
    ).toThrow(/agents\.apis\[0\]\.serviceDesc must have a valid href/);
    expect(() =>
      validateDocsConfig(
        withApis([{ href: "/ask", serviceDesc: { href: "/api%ZZ" } }]),
        CONFIG_PATH
      )
    ).toThrow(/serviceDesc must not contain a malformed percent escape/);
    expect(() =>
      validateDocsConfig(
        withApis([
          {
            href: "/ask",
            serviceDesc: { href: "/openapi.json", type: "application" },
          },
        ]),
        CONFIG_PATH
      )
    ).toThrow(
      /agents\.apis\[0\]\.serviceDesc\.type must be a valid ASCII media type/
    );
    expect(() =>
      validateDocsConfig(
        withApis([{ href: "/ask", serviceDesc: { href: "/openapi\tx" } }]),
        CONFIG_PATH
      )
    ).toThrow(/serviceDesc must not contain ASCII control characters/);
    expect(() =>
      validateDocsConfig(
        withApis([
          { href: "/ask", serviceDesc: { href: "/openapi\\v1.json" } },
        ]),
        CONFIG_PATH
      )
    ).toThrow(/serviceDesc must not contain backslashes/);
    expect(() =>
      validateDocsConfig(
        withApis([
          {
            href: "/ask",
            serviceDesc: [
              { href: "/openapi.json" },
              { href: "/open\uDC00api.json" },
            ],
          },
        ]),
        CONFIG_PATH
      )
    ).toThrow(
      /agents\.apis\[0\]\.serviceDesc\[1\] must not contain unpaired UTF-16 surrogates/
    );
    expect(() =>
      validateDocsConfig(withApis([{ href: "/api/😀" }]), CONFIG_PATH)
    ).not.toThrow();
    expect(() =>
      validateDocsConfig(
        withApis([
          {
            href: "/ask",
            status: [{ href: "/ok" }, { href: "/status", title: 7 }],
          },
        ]),
        CONFIG_PATH
      )
    ).toThrow(/agents\.apis\[0\]\.status\[1\]\.title must be a string/);
  });
});

function withNlweb(nlweb: unknown): unknown {
  return {
    product: { name: "Leadtype", tagline: "Docs pipeline." },
    agents: { nlweb },
  };
}

describe("agents.nlweb.openapi config validation", () => {
  it("accepts an endpoint alongside the OpenAPI document settings", () => {
    const config = validateDocsConfig(
      withNlweb({
        enabled: true,
        endpoint: "https://api.leadtype.dev/v1/ask",
        openapi: { url: "/api/openapi.json" },
      }),
      CONFIG_PATH
    );

    expect(config.agents?.nlweb?.endpoint).toBe(
      "https://api.leadtype.dev/v1/ask"
    );
    expect(config.agents?.nlweb?.openapi?.url).toBe("/api/openapi.json");
  });

  it("rejects a malformed absolute endpoint before generation", () => {
    expect(() =>
      validateDocsConfig(
        withNlweb({ enabled: true, endpoint: "https://%" }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.endpoint must be a valid absolute URL/);
  });

  it("rejects credentials in NLWeb and MCP endpoints", () => {
    for (const [agent, endpoint] of [
      ["nlweb", "https://user:pass@api.example/ask"],
      ["nlweb", "https://user@api.example/ask"],
      ["nlweb", "https://:pass@api.example/ask"],
      ["mcp", "https://user:pass@api.example/mcp"],
    ] as const) {
      expect(() =>
        validateDocsConfig(
          {
            product: { name: "Leadtype", tagline: "Docs pipeline." },
            agents: { [agent]: { enabled: true, endpoint } },
          },
          CONFIG_PATH
        )
      ).toThrow(
        `agents.${agent}.endpoint must not include a username or password`
      );
    }

    expect(() =>
      validateDocsConfig(
        withNlweb({
          enabled: true,
          endpoint: "https://api.example/users/user@example.com/ask",
        }),
        CONFIG_PATH
      )
    ).not.toThrow();
  });

  it("rejects malformed relative NLWeb and MCP endpoints", () => {
    for (const [agent, endpoint, message] of [
      ["nlweb", "/ask%ZZ", "a malformed percent escape"],
      ["nlweb", "/ask\nx", "ASCII control characters"],
      ["nlweb", "/api\\ask", "backslashes"],
      ["mcp", "/mcp%ZZ", "a malformed percent escape"],
      ["mcp", "/mcp\tx", "ASCII control characters"],
      ["mcp", "/api\\mcp", "backslashes"],
    ] as const) {
      expect(() =>
        validateDocsConfig(
          {
            product: { name: "Leadtype", tagline: "Docs pipeline." },
            agents: { [agent]: { enabled: true, endpoint } },
          },
          CONFIG_PATH
        )
      ).toThrow(`agents.${agent}.endpoint must not contain ${message}`);
    }
  });

  it("preserves the empty MCP default and rejects other blank endpoints", () => {
    for (const [agent, endpoint] of [
      ["nlweb", ""],
      ["nlweb", "   "],
      ["mcp", "   "],
    ] as const) {
      expect(() =>
        validateDocsConfig(
          {
            product: { name: "Leadtype", tagline: "Docs pipeline." },
            agents: { [agent]: { enabled: true, endpoint } },
          },
          CONFIG_PATH
        )
      ).toThrow(`agents.${agent}.endpoint must not be empty`);
    }

    const config = validateDocsConfig(
      {
        product: { name: "Leadtype", tagline: "Docs pipeline." },
        agents: { mcp: { enabled: true, endpoint: "" } },
      },
      CONFIG_PATH
    );
    expect(config.agents?.mcp?.endpoint).toBe("");
  });

  it("rejects a protocol-relative NLWeb endpoint", () => {
    expect(() =>
      validateDocsConfig(
        withNlweb({ enabled: true, endpoint: "//api.leadtype.dev/ask" }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.endpoint must not be protocol-relative/);
  });

  it("rejects scheme-like NLWeb and MCP endpoints", () => {
    for (const [agent, endpoint] of [
      ["nlweb", "mailto:docs@example.com"],
      ["nlweb", "custom:ask"],
      ["nlweb", "https:ask"],
      ["mcp", "mailto:docs@example.com"],
      ["mcp", "custom:mcp"],
      ["mcp", "https:mcp"],
    ] as const) {
      expect(() =>
        validateDocsConfig(
          {
            product: { name: "Leadtype", tagline: "Docs pipeline." },
            agents: { [agent]: { enabled: true, endpoint } },
          },
          CONFIG_PATH
        )
      ).toThrow(`agents.${agent}.endpoint must be an HTTP(S) URL or path`);
    }
  });

  it("rejects parent-relative NLWeb endpoints", () => {
    for (const endpoint of ["../ask", "v1/../../ask", "/%2e%2e/ask"]) {
      expect(() =>
        validateDocsConfig(withNlweb({ enabled: true, endpoint }), CONFIG_PATH)
      ).toThrow(
        /agents\.nlweb\.endpoint must not contain "\.\." path segments/
      );
    }
  });

  it("rejects queries and fragments in NLWeb endpoints", () => {
    for (const endpoint of [
      "/ask?tenant=acme",
      "/ask#results",
      "https://api.example/ask?tenant=acme",
      "https://api.example/ask#results",
    ]) {
      expect(() =>
        validateDocsConfig(withNlweb({ enabled: true, endpoint }), CONFIG_PATH)
      ).toThrow(
        /agents\.nlweb\.endpoint must not contain a query string or fragment/
      );
    }
  });

  it("rejects surrounding whitespace in NLWeb endpoints", () => {
    for (const endpoint of [" /ask", "/ask ", " https://api.example/ask "]) {
      expect(() =>
        validateDocsConfig(withNlweb({ enabled: true, endpoint }), CONFIG_PATH)
      ).toThrow(
        /agents\.nlweb\.endpoint must not contain surrounding whitespace/
      );
    }
    for (const endpoint of ["/ask", "/api ask"]) {
      expect(() =>
        validateDocsConfig(withNlweb({ enabled: true, endpoint }), CONFIG_PATH)
      ).not.toThrow();
    }
  });

  it("rejects a malformed openapi block", () => {
    expect(() =>
      validateDocsConfig(withNlweb({ openapi: "yes" }), CONFIG_PATH)
    ).toThrow(/agents\.nlweb\.openapi must be an object/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { enabled: "yes" } }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.openapi\.enabled must be a boolean/);
    expect(() =>
      validateDocsConfig(withNlweb({ openapi: { url: 7 } }), CONFIG_PATH)
    ).toThrow(/agents\.nlweb\.openapi\.url must be a string/);
    for (const openapi of [
      { url: "" },
      { output: "" },
      { url: "", output: "api.json" },
      { url: "/api.json", output: "" },
    ]) {
      expect(() =>
        validateDocsConfig(withNlweb({ openapi }), CONFIG_PATH)
      ).toThrow(/agents\.nlweb\.openapi\.(?:url|output).*must not be empty/);
    }
    expect(() =>
      validateDocsConfig(
        withNlweb({
          openapi: { url: "https://%", output: "openapi.json" },
        }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.openapi\.url.*malformed percent escape/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { url: "/api/%ZZ/openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.openapi\.url.*malformed percent escape/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { url: "/api\\openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.openapi\.url.*must not contain backslashes/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { url: "/api/openapi.json\n" } }),
        CONFIG_PATH
      )
    ).toThrow(
      /agents\.nlweb\.openapi\.url.*must not contain ASCII control characters/
    );
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { url: "/api%2Fv1/openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.openapi\.url.*percent-encoded path separators/);
  });

  it("rejects an output path that escapes or overwrites the output root", () => {
    // The document is written verbatim to this path, so an unsafe value has to
    // fail here rather than during a build that has already clobbered a file.
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { output: "../openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/must not contain "\." or "\.\." segments/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { output: "api%20spec/openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/must not contain percent escapes/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { output: "/srv/openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/must be relative to the output directory/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { output: "robots.txt" } }),
        CONFIG_PATH
      )
    ).toThrow(/would overwrite the generated "robots\.txt" artifact/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { output: "docs/openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/must not write into the generated "docs\/" directory/);
    for (const output of [
      "NUL.json",
      "api/PrN/openapi.json",
      "api/lpt1.log/openapi.json",
    ]) {
      expect(() =>
        validateDocsConfig(withNlweb({ openapi: { output } }), CONFIG_PATH)
      ).toThrow(/Windows reserved device-name segment/);
    }
    for (const output of ["api?/openapi.json", "api#/openapi.json"]) {
      expect(() =>
        validateDocsConfig(withNlweb({ openapi: { output } }), CONFIG_PATH)
      ).toThrow(/must not contain "\?" or "#" URL delimiters/);
    }
    expect(() =>
      validateDocsConfig(
        withNlweb({
          openapi: { url: "/api.json", output: "api\0/openapi.json" },
        }),
        CONFIG_PATH
      )
    ).toThrow(/agents\.nlweb\.openapi\.output.*ASCII control characters/);
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { url: "/openapi" } }),
        CONFIG_PATH
      )
    ).toThrow(/must end in "\.json"/);
  });

  it("names the config file in the failure", () => {
    expect(() =>
      validateDocsConfig(
        withNlweb({ openapi: { output: "../openapi.json" } }),
        CONFIG_PATH
      )
    ).toThrow(/docs config at "\/site\/leadtype\.config\.ts"/);
  });

  it("rejects OpenAPI and feed output path-shape collisions", () => {
    const configWithOutputs = (openapiOutput: string, feedOutput: string) => ({
      product: { name: "Leadtype", tagline: "Docs pipeline." },
      agents: {
        nlweb: {
          enabled: true,
          openapi: { output: openapiOutput },
        },
      },
      feeds: [
        {
          id: "updates",
          title: "Updates",
          source: { urlPrefix: "/changelog" },
          formats: ["rss"],
          output: { rss: feedOutput },
        },
      ],
    });

    expect(() =>
      validateDocsConfig(
        configWithOutputs("api.json", "/api.json/feed.xml"),
        CONFIG_PATH
      )
    ).toThrow(
      /generated output paths must not be equal, ancestors, or descendants/
    );
    expect(() =>
      validateDocsConfig(
        configWithOutputs("api/rss.xml/openapi.json", "/api/rss.xml"),
        CONFIG_PATH
      )
    ).toThrow(
      /generated output paths must not be equal, ancestors, or descendants/
    );
    expect(() =>
      validateDocsConfig(
        configWithOutputs("api.json", "/x/../api.json/feed.xml"),
        CONFIG_PATH
      )
    ).toThrow(
      /generated output paths must not be equal, ancestors, or descendants/
    );
    expect(() =>
      validateDocsConfig(
        configWithOutputs("api.json", "/x\\..\\api.json/feed.xml"),
        CONFIG_PATH
      )
    ).toThrow(
      /generated output paths must not be equal, ancestors, or descendants/
    );
    expect(() =>
      validateDocsConfig(
        configWithOutputs("api/openapi.json", "/feeds/rss.xml"),
        CONFIG_PATH
      )
    ).not.toThrow();
  });
});
