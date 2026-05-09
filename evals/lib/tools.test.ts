import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveScoped, scopedTools } from "./tools";
import type { ToolCall } from "./transcript";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "tools-test-"));
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

describe("resolveScoped", () => {
  it("resolves a relative path inside the tempdir", () => {
    const result = resolveScoped(tempDir, "subdir/file.txt");
    expect(result).toBe(path.join(tempDir, "subdir", "file.txt"));
  });

  it("treats an absolute-looking path as relative to the tempdir", () => {
    const result = resolveScoped(tempDir, "/some/file.txt");
    expect(result).toBe(path.join(tempDir, "some", "file.txt"));
  });

  it("rejects ../../ traversal that escapes the root", () => {
    expect(() => resolveScoped(tempDir, "../../../etc/passwd")).toThrow(
      /path escape rejected/
    );
  });

  it("rejects subdir/../.. style escapes", () => {
    expect(() => resolveScoped(tempDir, "subdir/../..")).toThrow(
      /path escape rejected/
    );
  });

  it("rejects an empty path", () => {
    expect(() => resolveScoped(tempDir, "")).toThrow(/path is required/);
  });

  it("allows the tempdir root itself", () => {
    expect(resolveScoped(tempDir, ".")).toBe(path.resolve(tempDir));
  });
});

describe("read tool", () => {
  it("reads a file inside the tempdir and records the call", async () => {
    await writeFile(path.join(tempDir, "hello.txt"), "world");
    const transcript: ToolCall[] = [];
    const filesModified = new Set<string>();
    const tools = scopedTools({ tempDir, transcript, filesModified });

    const result = await tools.read.execute(
      { path: "hello.txt" },
      { toolCallId: "t1", messages: [] }
    );

    expect(result).toBe("world");
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.tool).toBe("read");
    expect(transcript[0]?.args.path).toBe("hello.txt");
  });

  it("rejects a path that escapes the tempdir", async () => {
    const transcript: ToolCall[] = [];
    const filesModified = new Set<string>();
    const tools = scopedTools({ tempDir, transcript, filesModified });

    await expect(
      tools.read.execute(
        { path: "../../../etc/passwd" },
        { toolCallId: "t2", messages: [] }
      )
    ).rejects.toThrow(/path escape rejected/);
    // Failed call is still recorded with an error summary.
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.resultSummary).toMatch(/error: path escape/);
  });
});

describe("write tool", () => {
  it("writes a file under the tempdir and tracks it in filesModified", async () => {
    const transcript: ToolCall[] = [];
    const filesModified = new Set<string>();
    const tools = scopedTools({ tempDir, transcript, filesModified });

    await tools.write.execute(
      { path: "out/sub/note.md", content: "hi" },
      { toolCallId: "t3", messages: [] }
    );

    expect(filesModified.has("out/sub/note.md")).toBe(true);
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.tool).toBe("write");
  });
});
