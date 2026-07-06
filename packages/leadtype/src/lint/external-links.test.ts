import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkExternalLinks, type ExternalLink } from "./external-links";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function createCacheFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-extlinks-"));
  tempDirs.push(dir);
  return path.join(dir, "external-links.json");
}

function link(url: string, file = "index.mdx", line = 3): ExternalLink {
  return { file, line, url };
}

type StubRoute = (method: string) => { status: number } | Error;

function stubFetcher(routes: Record<string, StubRoute>): {
  fetcher: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const route = routes[url];
    if (!route) {
      return Promise.reject(new Error(`no stub for ${url}`));
    }
    const result = route(method);
    if (result instanceof Error) {
      return Promise.reject(result);
    }
    // Not a real Response: the WHATWG constructor rejects statuses outside
    // 200-599, but live servers do send e.g. LinkedIn's 999 bot-block.
    const { status } = result;
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
    } as Response);
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("checkExternalLinks", () => {
  it("passes live links and reports dead ones with status detail", async () => {
    const { fetcher } = stubFetcher({
      "https://ok.example/page": () => ({ status: 200 }),
      "https://gone.example/page": () => ({ status: 404 }),
    });

    const issues = await checkExternalLinks({
      links: [
        link("https://ok.example/page"),
        link("https://gone.example/page", "guide.mdx", 12),
      ],
      fetcher,
    });

    expect(issues).toEqual([
      expect.objectContaining({
        rule: "external-link",
        file: "guide.mdx",
        line: 12,
        message: expect.stringContaining("HTTP 404"),
      }),
    ]);
  });

  it("falls back to GET when HEAD is rejected", async () => {
    const { fetcher, calls } = stubFetcher({
      "https://headless.example/": (method) =>
        method === "HEAD" ? { status: 405 } : { status: 200 },
    });

    const issues = await checkExternalLinks({
      links: [link("https://headless.example/")],
      fetcher,
    });

    expect(issues).toEqual([]);
    expect(calls).toEqual([
      "HEAD https://headless.example/",
      "GET https://headless.example/",
    ]);
  });

  it("treats rate-limited and auth/bot-gated responses as skip, not failure", async () => {
    const { fetcher } = stubFetcher({
      "https://busy.example/": () => ({ status: 429 }),
      "https://gated.example/": () => ({ status: 403 }),
      "https://members.example/": () => ({ status: 401 }),
      "https://linkedin.example/": () => ({ status: 999 }),
    });

    const issues = await checkExternalLinks({
      links: [
        link("https://busy.example/"),
        link("https://gated.example/"),
        link("https://members.example/"),
        link("https://linkedin.example/"),
      ],
      fetcher,
    });

    expect(issues).toEqual([]);
  });

  it("retries once before reporting a network failure", async () => {
    let attempts = 0;
    const { fetcher, calls } = stubFetcher({
      "https://flaky.example/": () => {
        attempts += 1;
        return attempts === 1 ? new Error("socket hangup") : { status: 200 };
      },
    });

    const issues = await checkExternalLinks({
      links: [link("https://flaky.example/")],
      fetcher,
    });

    expect(issues).toEqual([]);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("caches live results and skips the network within the TTL", async () => {
    const cacheFile = await createCacheFile();
    const { fetcher, calls } = stubFetcher({
      "https://ok.example/": () => ({ status: 200 }),
    });

    let clock = 1_000_000;
    const now = () => clock;
    const options = {
      links: [link("https://ok.example/")],
      cacheFile,
      fetcher,
      now,
      ttlMs: 60_000,
    };

    await checkExternalLinks(options);
    expect(calls).toHaveLength(1);
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(cached.entries)).toContain("https://ok.example/");

    // Warm run inside the TTL: no network.
    await checkExternalLinks(options);
    expect(calls).toHaveLength(1);

    // Past the TTL: re-checked.
    clock += 120_000;
    await checkExternalLinks(options);
    expect(calls).toHaveLength(2);
  });

  it("never caches failures", async () => {
    const cacheFile = await createCacheFile();
    const { fetcher, calls } = stubFetcher({
      "https://gone.example/": () => ({ status: 404 }),
    });

    const options = {
      links: [link("https://gone.example/")],
      cacheFile,
      fetcher,
    };
    await checkExternalLinks(options);
    await checkExternalLinks(options);
    // Two runs, both hit the network (each with HEAD + retry probes).
    expect(
      calls.filter((entry) => entry.startsWith("HEAD")).length
    ).toBeGreaterThanOrEqual(2);
  });

  it("skips ignored URL prefixes without touching the network", async () => {
    const { fetcher, calls } = stubFetcher({});

    const issues = await checkExternalLinks({
      links: [link("https://ratelimity.example/api/docs")],
      ignore: ["https://ratelimity.example/"],
      fetcher,
    });

    expect(issues).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("checks each unique URL once even when linked from many pages", async () => {
    const { fetcher, calls } = stubFetcher({
      "https://ok.example/": () => ({ status: 200 }),
    });

    await checkExternalLinks({
      links: [
        link("https://ok.example/", "a.mdx"),
        link("https://ok.example/", "b.mdx"),
        link("https://ok.example/", "c.mdx"),
      ],
      fetcher,
    });

    expect(calls).toHaveLength(1);
  });
});
