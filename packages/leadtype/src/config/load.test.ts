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
