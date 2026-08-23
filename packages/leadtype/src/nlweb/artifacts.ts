import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../internal/atomic-fs.js";
import { normalizeBaseUrl } from "../internal/docs-url.js";
import { acquireGenerateLock } from "../internal/generate-lock.js";
import type { LlmsProductInfo } from "../llm/llm.js";
import type { AgentReadabilityPage } from "../llm/readability.js";
import {
  type AskOpenApiDocument,
  assertNlwebOutputPathInsideRoot,
  assertSafeNlwebOpenApiOutput,
  buildAskOpenApiDocument,
  hasValidAskOpenApiOwnershipMarker,
  type NlwebOpenApiConfig,
  renderAskOpenApiDocument,
  resolveNlwebOpenApiConfig,
  writeAskOpenApiDocument,
} from "./openapi.js";
import {
  NLWEB_GENERATION_STATE_FILE,
  NLWEB_SCHEMA_FEED_PATH,
  NLWEB_SCHEMA_MAP_PATH,
} from "./paths.js";

export type GenerateNlwebArtifactsConfig = {
  /** Output root (the site `public` dir). */
  outDir: string;
  /** Optional non-public directory used to track generated-file ownership. */
  stateDir?: string;
  baseUrl?: string;
  product: LlmsProductInfo;
  /** Pages from the agent-readability manifest. */
  pages: AgentReadabilityPage[];
  /** The `/ask` endpoint path or absolute URL, as authored. Defaults to `/ask`. */
  askEndpoint?: string;
  /** OpenAPI description of `/ask`. Emitted unless `enabled: false`. */
  openapi?: NlwebOpenApiConfig;
  /** Human-readable API documentation, linked from the OpenAPI document. */
  docsUrl?: string;
};

export type GenerateNlwebArtifactsResult = {
  files: {
    schemaFeed: string;
    schemaMap: string;
    /** Absent when the OpenAPI document is turned off. */
    openapi?: string;
  };
  /** Site-relative URL path of the schema map, for the robots.txt directive. */
  schemaMapUrlPath: string;
  /** Public URL the OpenAPI document is served at, when one was emitted. */
  openapiUrl?: string;
  /** The emitted OpenAPI document, for callers that describe it further. */
  openapiDocument?: AskOpenApiDocument;
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const XML_ESCAPE_PATTERN = /[&<>"']/g;
const NLWEB_GENERATION_STATE_VERSION = 4;
const LEGACY_NLWEB_GENERATION_STATE_VERSIONS = new Set([2, 3]);
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;

type NlwebGenerationOutput = {
  outDir: string;
  openapiOutput: string;
  /** Absent only while conservatively reading legacy v2/v3 state. */
  openapiSha256?: string;
};

type NlwebGenerationState = {
  version: typeof NLWEB_GENERATION_STATE_VERSION;
  outputs: NlwebGenerationOutput[];
};

function parseNlwebGenerationOutput(
  value: unknown,
  acceptFingerprint: boolean
): NlwebGenerationOutput | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("outDir" in value) ||
    typeof value.outDir !== "string" ||
    !path.isAbsolute(value.outDir) ||
    !("openapiOutput" in value) ||
    typeof value.openapiOutput !== "string"
  ) {
    return null;
  }
  const output: NlwebGenerationOutput = {
    outDir: value.outDir,
    openapiOutput: assertSafeNlwebOpenApiOutput(
      value.openapiOutput,
      "generated NLWeb state openapiOutput"
    ),
  };
  if (
    acceptFingerprint &&
    "openapiSha256" in value &&
    typeof value.openapiSha256 === "string" &&
    SHA_256_PATTERN.test(value.openapiSha256)
  ) {
    output.openapiSha256 = value.openapiSha256;
  }
  return output;
}

async function readNlwebGenerationState(
  stateDir: string | undefined
): Promise<NlwebGenerationState | null> {
  if (!stateDir) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      await readFile(path.join(stateDir, NLWEB_GENERATION_STATE_FILE), "utf8")
    ) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed)
    ) {
      return null;
    }
    if (parsed.version === 2) {
      if (!("openapiOutput" in parsed)) {
        return { version: NLWEB_GENERATION_STATE_VERSION, outputs: [] };
      }
      const output = parseNlwebGenerationOutput(parsed, false);
      return output
        ? { version: NLWEB_GENERATION_STATE_VERSION, outputs: [output] }
        : null;
    }
    const hasSupportedVersion =
      parsed.version === NLWEB_GENERATION_STATE_VERSION ||
      LEGACY_NLWEB_GENERATION_STATE_VERSIONS.has(parsed.version as number);
    if (
      !(
        hasSupportedVersion &&
        "outputs" in parsed &&
        Array.isArray(parsed.outputs)
      )
    ) {
      return null;
    }
    const acceptFingerprint = parsed.version === NLWEB_GENERATION_STATE_VERSION;
    const outputs = parsed.outputs.map((output) =>
      parseNlwebGenerationOutput(output, acceptFingerprint)
    );
    if (outputs.some((output) => output === null)) {
      return null;
    }
    return {
      version: NLWEB_GENERATION_STATE_VERSION,
      outputs: outputs as NlwebGenerationOutput[],
    };
  } catch {
    return null;
  }
}

async function writeNlwebGenerationState(
  stateDir: string | undefined,
  outputs: NlwebGenerationOutput[]
): Promise<boolean> {
  if (!stateDir) {
    return false;
  }
  const statePath = path.join(stateDir, NLWEB_GENERATION_STATE_FILE);
  const verifiedOutputs = outputs.filter(
    (output): output is NlwebGenerationOutput & { openapiSha256: string } =>
      output.openapiSha256 !== undefined
  );
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFileAtomic(
      statePath,
      `${JSON.stringify(
        {
          version: NLWEB_GENERATION_STATE_VERSION,
          outputs: verifiedOutputs,
        } satisfies NlwebGenerationState,
        null,
        2
      )}\n`
    );
    return true;
  } catch {
    // Ownership metadata enables later cleanup but must not make a build fail
    // when documentation is read from an immutable source mount.
    return false;
  }
}

async function stateLockKey(stateDir: string): Promise<string> {
  const unresolvedSegments: string[] = [];
  let candidate = path.resolve(stateDir);
  while (true) {
    try {
      const existingAncestor = await realpath(candidate);
      return path.join(
        existingAncestor,
        ...unresolvedSegments.reverse(),
        NLWEB_GENERATION_STATE_FILE
      );
    } catch (error) {
      if (!isMissingFileError(error)) {
        // Prefer availability when canonicalization itself fails; callers may
        // briefly lose symlink-alias serialization until realpath succeeds.
        return path.join(path.resolve(stateDir), NLWEB_GENERATION_STATE_FILE);
      }
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return path.join(path.resolve(stateDir), NLWEB_GENERATION_STATE_FILE);
    }
    unresolvedSegments.push(path.basename(candidate));
    candidate = parent;
  }
}

async function withNlwebGenerationStateLock<T>(
  stateDir: string | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (!stateDir || process.env.LEADTYPE_NO_LOCK === "1") {
    return operation();
  }
  const waitTimeoutMs = Number(process.env.LEADTYPE_LOCK_TIMEOUT_MS);
  const lock = await acquireGenerateLock(
    await stateLockKey(stateDir),
    Number.isFinite(waitTimeoutMs) && waitTimeoutMs > 0 ? { waitTimeoutMs } : {}
  );
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

async function referToSameFilesystemEntry(
  left: string,
  right: string
): Promise<boolean> {
  try {
    const [resolvedLeft, resolvedRight] = await Promise.all([
      realpath(left),
      realpath(right),
    ]);
    if (process.platform === "win32") {
      return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
    }
    return resolvedLeft === resolvedRight;
  } catch {
    return false;
  }
}

async function refersToSameOutputRoot(
  left: string,
  right: string
): Promise<boolean> {
  return left === right || (await referToSameFilesystemEntry(left, right));
}

async function findNlwebGenerationOutput(
  state: NlwebGenerationState | null,
  outDir: string
): Promise<NlwebGenerationOutput | undefined> {
  if (!state) {
    return;
  }
  for (const output of state.outputs) {
    if (await refersToSameOutputRoot(output.outDir, outDir)) {
      return output;
    }
  }
}

async function replaceNlwebGenerationOutput(
  state: NlwebGenerationState | null,
  outDir: string,
  next?: NlwebGenerationOutput
): Promise<NlwebGenerationOutput[]> {
  const outputs: NlwebGenerationOutput[] = [];
  for (const output of state?.outputs ?? []) {
    if (!(await refersToSameOutputRoot(output.outDir, outDir))) {
      outputs.push(output);
    }
  }
  if (next) {
    outputs.push(next);
  }
  return outputs;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

type TrackedFileStatus = "missing" | "owned" | "unowned" | "unverifiable";

function sha256(contents: string | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function fingerprintFile(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

async function trackedFileStatus(
  outDir: string,
  output: NlwebGenerationOutput,
  generatedSha256?: string
): Promise<TrackedFileStatus> {
  const openapiFile = path.resolve(outDir, output.openapiOutput);
  await assertNlwebOutputPathInsideRoot(outDir, openapiFile);
  if (!(output.openapiSha256 || generatedSha256)) {
    return "unowned";
  }
  let info: Stats;
  try {
    info = await lstat(openapiFile);
  } catch (error) {
    return isMissingFileError(error) ? "missing" : "unverifiable";
  }
  if (!info.isFile()) {
    return "unowned";
  }
  try {
    const fingerprint = await fingerprintFile(openapiFile);
    return fingerprint === output.openapiSha256 ||
      fingerprint === generatedSha256
      ? "owned"
      : "unowned";
  } catch (error) {
    return isMissingFileError(error) ? "missing" : "unverifiable";
  }
}

function unownedOutputError(output: string): Error {
  return new Error(
    `leadtype: tracked NLWeb OpenAPI output "${output}" no longer matches the generated file; preserving it as unowned content.`
  );
}

function occupiedOutputError(output: string): Error {
  return new Error(
    `leadtype: NLWeb OpenAPI output destination "${output}" already exists and is not owned by this generation state; preserving it as unowned content.`
  );
}

type FileSnapshot =
  | { kind: "file"; contents: Uint8Array }
  | { kind: "missing" };

async function snapshotFile(filePath: string): Promise<FileSnapshot> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile()) {
      throw new Error(`NLWeb OpenAPI output is not a file: "${filePath}"`);
    }
    return { kind: "file", contents: await readFile(filePath) };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { kind: "missing" };
    }
    throw error;
  }
}

async function restoreFileSnapshot(
  filePath: string,
  snapshot: FileSnapshot
): Promise<void> {
  if (snapshot.kind === "file") {
    await writeFileAtomic(filePath, snapshot.contents);
    return;
  }
  await rm(filePath, { force: true });
}

async function writeAskOpenApiDocumentTransaction(config: {
  outDir: string;
  output: string;
  document: AskOpenApiDocument;
  requireMissingOutput?: boolean;
  expectedExistingSha256?: string;
  reuseExistingOutput?: boolean;
  beforeCommit?: () => Promise<void>;
  rollbackBeforeCommit?: () => Promise<void>;
  commitState: () => Promise<boolean>;
}): Promise<string> {
  const outputFile = path.resolve(config.outDir, config.output);
  const snapshot = await snapshotFile(outputFile);
  if (
    config.expectedExistingSha256 &&
    (snapshot.kind !== "file" ||
      sha256(snapshot.contents) !== config.expectedExistingSha256)
  ) {
    throw occupiedOutputError(config.output);
  }
  if (config.requireMissingOutput && snapshot.kind === "file") {
    throw occupiedOutputError(config.output);
  }
  let outputWritten = false;
  let beforeCommitCompleted = false;
  try {
    const generatedFile = config.reuseExistingOutput
      ? outputFile
      : await writeAskOpenApiDocument(config);
    outputWritten = !config.reuseExistingOutput;
    if (config.beforeCommit) {
      await config.beforeCommit();
      beforeCommitCompleted = true;
    }
    if (!(await config.commitState())) {
      throw new Error(
        "leadtype: could not update NLWeb ownership state after writing the generated OpenAPI output."
      );
    }
    return generatedFile;
  } catch (error) {
    if (beforeCommitCompleted && config.rollbackBeforeCommit) {
      await config.rollbackBeforeCommit().catch(() => undefined);
    }
    if (outputWritten) {
      await restoreFileSnapshot(outputFile, snapshot);
    }
    throw error;
  }
}

function outputContainsPath(ancestor: string, descendant: string): boolean {
  return descendant.startsWith(`${ancestor}/`);
}

function resolveOutputPrefix(
  outDir: string,
  descendant: string,
  ancestorSegmentCount: number
): string {
  return path.resolve(
    outDir,
    descendant.split("/").slice(0, ancestorSegmentCount).join("/")
  );
}

async function outputContainsPathOnFilesystem(
  outDir: string,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  if (outputContainsPath(ancestor, descendant)) {
    return true;
  }
  const ancestorSegments = ancestor.split("/");
  const descendantSegments = descendant.split("/");
  if (ancestorSegments.length >= descendantSegments.length) {
    return false;
  }
  const descendantPrefix = descendantSegments
    .slice(0, ancestorSegments.length)
    .join("/");
  return referToSameFilesystemEntry(
    path.resolve(outDir, ancestor),
    path.resolve(outDir, descendantPrefix)
  );
}

async function removeEmptyDirectoriesThrough(
  start: string,
  stop: string
): Promise<void> {
  let current = start;
  while (true) {
    try {
      await rmdir(current);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
    if (current === stop) {
      return;
    }
    current = path.dirname(current);
  }
}

async function writeAskOpenApiDocumentAcrossPathShape(config: {
  outDir: string;
  previousOutput: string;
  output: string;
  previousContainsOutput: boolean;
  outputContainsPrevious: boolean;
  document: AskOpenApiDocument;
  commitState: () => Promise<boolean>;
}): Promise<string> {
  const stageDir = await mkdtemp(
    path.join(config.outDir, ".leadtype-nlweb-openapi-move-")
  );
  let stagedFile: string;
  try {
    stagedFile = await writeAskOpenApiDocument({
      outDir: stageDir,
      output: "openapi.json",
      document: config.document,
    });
  } catch (error) {
    await rm(stageDir, { force: true, recursive: true });
    throw error;
  }
  const previousFile = path.resolve(config.outDir, config.previousOutput);
  const outputFile = path.resolve(config.outDir, config.output);
  const backupFile = path.join(stageDir, "previous-openapi.json");
  let previousBackedUp = false;
  let previousRestored = false;
  let outputCommitted = false;

  try {
    await assertNlwebOutputPathInsideRoot(config.outDir, previousFile);
    await assertNlwebOutputPathInsideRoot(config.outDir, outputFile);
    try {
      const previousStat = await lstat(previousFile);
      if (!previousStat.isFile()) {
        throw new Error(
          `tracked NLWeb OpenAPI output is no longer a file: "${previousFile}"`
        );
      }
      await rename(previousFile, backupFile);
      previousBackedUp = true;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    if (config.outputContainsPrevious) {
      await removeEmptyDirectoriesThrough(
        path.dirname(previousFile),
        resolveOutputPrefix(
          config.outDir,
          config.previousOutput,
          config.output.split("/").length
        )
      );
    }
    await mkdir(path.dirname(outputFile), { recursive: true });
    await rename(stagedFile, outputFile);
    outputCommitted = true;
    if (!(await config.commitState())) {
      throw new Error(
        "leadtype: could not update NLWeb ownership state after moving the generated OpenAPI output."
      );
    }
    if (previousBackedUp) {
      await rm(backupFile, { force: true }).catch(() => undefined);
    }
    await rm(stageDir, { force: true, recursive: true }).catch(() => undefined);
    return outputFile;
  } catch (error) {
    if (outputCommitted) {
      await rm(outputFile, { force: true });
    }
    if (previousBackedUp) {
      if (config.previousContainsOutput) {
        await removeEmptyDirectoriesThrough(
          path.dirname(outputFile),
          resolveOutputPrefix(
            config.outDir,
            config.output,
            config.previousOutput.split("/").length
          )
        );
      }
      await mkdir(path.dirname(previousFile), { recursive: true });
      await rename(backupFile, previousFile);
      previousRestored = true;
    }
    if (!previousBackedUp || previousRestored) {
      await rm(stageDir, { force: true, recursive: true });
    }
    throw error;
  }
}

export async function removeGeneratedNlwebOpenApi(config: {
  outDir: string;
  stateDir?: string;
}): Promise<void> {
  const outDir = path.resolve(config.outDir);
  await withNlwebGenerationStateLock(config.stateDir, async () => {
    const state = await readNlwebGenerationState(config.stateDir);
    const trackedOutput = await findNlwebGenerationOutput(state, outDir);
    if (!(state && trackedOutput)) {
      return;
    }
    const status = await trackedFileStatus(outDir, trackedOutput);
    if (status === "unverifiable") {
      return;
    }
    const outputs = await replaceNlwebGenerationOutput(state, outDir);
    if (
      status === "owned" &&
      !(await writeNlwebGenerationState(config.stateDir, state.outputs))
    ) {
      return;
    }
    if (status === "owned") {
      const openapiFile = path.resolve(outDir, trackedOutput.openapiOutput);
      await rm(openapiFile, { force: true });
    }
    await writeNlwebGenerationState(config.stateDir, outputs);
  });
}

function escapeXml(value: string): string {
  return value.replace(XML_ESCAPE_PATTERN, (char) => XML_ESCAPES[char] ?? char);
}

function toSchemaFeedLine(
  page: AgentReadabilityPage,
  product: LlmsProductInfo,
  baseUrl: string
): string {
  const pageUrl = baseUrl ? page.absoluteUrl : page.urlPath;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": pageUrl,
    url: pageUrl,
    name: page.title,
    ...(page.description ? { description: page.description } : {}),
    ...(page.lastModified ? { dateModified: page.lastModified } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: product.name,
      ...(baseUrl ? { url: baseUrl } : {}),
    },
  });
}

function renderSchemaMapXml(feedUrl: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    "<schemamap>",
    "  <feed>",
    `    <loc>${escapeXml(feedUrl)}</loc>`,
    "    <format>application/jsonl</format>",
    "    <itemType>https://schema.org/TechArticle</itemType>",
    "  </feed>",
    "</schemamap>",
    "",
  ].join("\n");
}

/**
 * Emit the NLWeb schema-feed surface: a JSONL feed of schema.org items (one
 * per docs page) plus a `/schema-map.xml` that lists it. Reference the map
 * from robots.txt via the `Schemamap:` directive (see `renderRobotsTxt`'s
 * `schemamapUrlPath`) so natural-language retrieval systems can find the feed.
 */
export async function generateNlwebArtifacts(
  config: GenerateNlwebArtifactsConfig
): Promise<GenerateNlwebArtifactsResult> {
  const outDir = path.resolve(config.outDir);
  const baseUrl = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : "";
  const openapi = resolveNlwebOpenApiConfig(config.openapi);
  const schemaFeed = path.join(outDir, NLWEB_SCHEMA_FEED_PATH);
  const schemaMap = path.join(outDir, NLWEB_SCHEMA_MAP_PATH);

  const lines = config.pages.map((page) =>
    toSchemaFeedLine(page, config.product, baseUrl)
  );
  await mkdir(path.dirname(schemaFeed), { recursive: true });
  await writeFileAtomic(schemaFeed, `${lines.join("\n")}\n`);
  await writeFileAtomic(
    schemaMap,
    renderSchemaMapXml(`${baseUrl}/${NLWEB_SCHEMA_FEED_PATH}`)
  );

  if (!openapi) {
    await removeGeneratedNlwebOpenApi({
      outDir,
      ...(config.stateDir ? { stateDir: config.stateDir } : {}),
    });
    return {
      files: { schemaFeed, schemaMap },
      schemaMapUrlPath: `/${NLWEB_SCHEMA_MAP_PATH}`,
    };
  }
  const document = buildAskOpenApiDocument({
    product: config.product,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.askEndpoint === undefined
      ? {}
      : { askEndpoint: config.askEndpoint }),
    ...(config.docsUrl ? { docsUrl: config.docsUrl } : {}),
  });
  const generatedSha256 = sha256(renderAskOpenApiDocument(document));
  const openapiFile = await withNlwebGenerationStateLock(
    config.stateDir,
    async () => {
      const previousState = await readNlwebGenerationState(config.stateDir);
      const trackedOutput = await findNlwebGenerationOutput(
        previousState,
        outDir
      );
      const previousOutput = trackedOutput?.openapiOutput;
      const previousStatus = trackedOutput
        ? await trackedFileStatus(outDir, trackedOutput, generatedSha256)
        : "missing";
      if (previousStatus === "unverifiable") {
        throw new Error(
          `leadtype: could not verify the tracked NLWeb OpenAPI output "${previousOutput}"; preserving its ownership state.`
        );
      }
      const untrackedDestinationStatus = trackedOutput
        ? undefined
        : await trackedFileStatus(outDir, {
            outDir,
            openapiOutput: openapi.output,
            openapiSha256: generatedSha256,
          });
      if (untrackedDestinationStatus === "unverifiable") {
        throw new Error(
          `leadtype: could not verify the NLWeb OpenAPI output destination "${openapi.output}"; preserving it as unowned content.`
        );
      }
      const outputChanged =
        previousOutput !== undefined && previousOutput !== openapi.output;
      const previousContainsOutput =
        outputChanged &&
        (await outputContainsPathOnFilesystem(
          outDir,
          previousOutput,
          openapi.output
        ));
      const outputContainsPrevious =
        outputChanged &&
        (await outputContainsPathOnFilesystem(
          outDir,
          openapi.output,
          previousOutput
        ));
      const hasPathShapeConflict =
        previousContainsOutput || outputContainsPrevious;
      const hasFilesystemEquivalentOutput =
        outputChanged &&
        previousStatus !== "missing" &&
        (await referToSameFilesystemEntry(
          path.resolve(outDir, previousOutput),
          path.resolve(outDir, openapi.output)
        ));
      const destinationSnapshot = hasPathShapeConflict
        ? undefined
        : await snapshotFile(path.resolve(outDir, openapi.output));
      const destinationSha256 =
        destinationSnapshot?.kind === "file"
          ? sha256(destinationSnapshot.contents)
          : undefined;
      const destinationMatchesGenerated = destinationSha256 === generatedSha256;
      const destinationHasOwnershipMarker =
        destinationSnapshot?.kind === "file" &&
        hasValidAskOpenApiOwnershipMarker(destinationSnapshot.contents);

      if (
        untrackedDestinationStatus === "unowned" &&
        !destinationHasOwnershipMarker
      ) {
        throw occupiedOutputError(openapi.output);
      }

      if (
        previousStatus === "unowned" &&
        !destinationHasOwnershipMarker &&
        (!outputChanged ||
          hasPathShapeConflict ||
          hasFilesystemEquivalentOutput)
      ) {
        throw unownedOutputError(previousOutput ?? openapi.output);
      }

      const outputs = await replaceNlwebGenerationOutput(
        previousState,
        outDir,
        {
          outDir,
          openapiOutput: openapi.output,
          openapiSha256: generatedSha256,
        }
      );
      const stateAlreadyCurrent =
        trackedOutput?.openapiOutput === openapi.output &&
        trackedOutput.openapiSha256 === generatedSha256;
      const expectedExistingSha256 =
        destinationMatchesGenerated || destinationHasOwnershipMarker
          ? destinationSha256
          : undefined;
      if (
        trackedOutput &&
        !stateAlreadyCurrent &&
        !(await writeNlwebGenerationState(
          config.stateDir,
          previousState?.outputs ?? []
        )) &&
        !destinationHasOwnershipMarker
      ) {
        throw new Error(
          "leadtype: could not update NLWeb ownership state before replacing the generated OpenAPI output."
        );
      }
      const commitState = async (): Promise<boolean> => {
        if (stateAlreadyCurrent || !config.stateDir) {
          return true;
        }
        const written = await writeNlwebGenerationState(
          config.stateDir,
          outputs
        );
        return written || !trackedOutput || destinationHasOwnershipMarker;
      };

      const movablePreviousOutput =
        previousStatus === "owned" ? previousOutput : undefined;
      const removablePreviousFile =
        movablePreviousOutput &&
        outputChanged &&
        !hasPathShapeConflict &&
        !hasFilesystemEquivalentOutput
          ? path.resolve(outDir, movablePreviousOutput)
          : undefined;
      const removablePreviousSnapshot = removablePreviousFile
        ? await snapshotFile(removablePreviousFile)
        : undefined;
      const generatedFile =
        hasPathShapeConflict && movablePreviousOutput
          ? await writeAskOpenApiDocumentAcrossPathShape({
              outDir,
              previousOutput: movablePreviousOutput,
              output: openapi.output,
              previousContainsOutput,
              outputContainsPrevious,
              document,
              commitState,
            })
          : await writeAskOpenApiDocumentTransaction({
              outDir,
              output: openapi.output,
              document,
              ...(expectedExistingSha256 ? { expectedExistingSha256 } : {}),
              ...(destinationMatchesGenerated
                ? { reuseExistingOutput: true }
                : {}),
              ...(!expectedExistingSha256 &&
              ((outputChanged && !hasFilesystemEquivalentOutput) ||
                untrackedDestinationStatus === "missing")
                ? { requireMissingOutput: true }
                : {}),
              ...(removablePreviousFile
                ? {
                    beforeCommit: async () => {
                      await rm(removablePreviousFile, { force: true });
                    },
                    rollbackBeforeCommit: async () => {
                      if (removablePreviousSnapshot) {
                        await restoreFileSnapshot(
                          removablePreviousFile,
                          removablePreviousSnapshot
                        );
                      }
                    },
                  }
                : {}),
              commitState,
            });
      return generatedFile;
    }
  );

  return {
    files: { schemaFeed, schemaMap, openapi: openapiFile },
    schemaMapUrlPath: `/${NLWEB_SCHEMA_MAP_PATH}`,
    openapiUrl: openapi.url,
    openapiDocument: document,
  };
}
