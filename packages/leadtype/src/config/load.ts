/**
 * Config discovery, validation, and loading.
 *
 * Lives outside `cli/` because the runtime needs it too: `createDocsProject()`
 * and `leadtype doctor` both have to answer "which config describes this
 * project?", and a runtime importing the generate pipeline to ask that would
 * drag the whole staging/conversion stack into an app bundle.
 *
 * Validation checks the shape as authored; {@link normalizeDocsConfig} then
 * folds deprecated aliases onto canonical names and derives the resolved
 * project. Loading is where the two meet, so every caller gets both.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeDocsPath } from "../internal/docs-url";
import { editDistanceWithin } from "../internal/edit-distance";
import { type LogCall, logger } from "../internal/logger";
import { isAsciiMediaType } from "../internal/media-type";
import { hasUnpairedUtf16Surrogate } from "../internal/unicode";
import type {
  DocsCollection,
  DocsConfig,
  DocsFeedConfig,
  DocsFrontmatterSchema,
  DocsGroup,
  DocsLlmsConfig,
  DocsNavEntry,
  GitSourceSpec,
  OrganizationInfo,
  ProductInfo,
  SourceConfigInheritField,
} from "../llm";
import { isGitSourceSpec } from "../llm";
import { DOCS_TOOL_NAMES } from "../mcp/tools";
import {
  assertSafeNlwebAskEndpoint,
  type NlwebOpenApiConfig,
  resolveNlwebOpenApiConfig,
} from "../nlweb/openapi";
import { validateDocsOpenApiConfig } from "../openapi";
import type { DocsTransformer } from "../transformers";
import {
  DOCS_CONFIG_FILENAMES,
  importConfigModule,
  isPlainRecord,
  isStringArray,
  LEADTYPE_CONFIG_FILENAMES,
  SOURCE_CONFIG_INHERIT_FIELDS,
  validateDocsGroups,
  validateDocsMounts,
  validateDocsNav,
} from "./inherit";
import { formatDeprecationWarning, normalizeDocsConfig } from "./normalize";
import type { ResolvedDocsConfig } from "./types";

const FEED_FORMAT_VALUES = new Set(["rss", "atom"]);
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A non-fatal problem found while validating a config. Errors throw; warnings
 * ride along on the loaded config so `resolveProject` can surface them as
 * diagnostics and `doctor` as findings with a stable id.
 */
export type ConfigWarning = {
  /** Stable id, shared with `leadtype doctor` findings. */
  id: "config.unknown-key";
  message: string;
  /** Field path as authored, e.g. `collections.docs.routePrefx`. */
  owner: string;
  /** A concrete next step. */
  fix?: string;
};

/** Where load-time warnings go. Defaults to the process-wide logger. */
export type ConfigWarningSink = (call: LogCall) => void;

export type LoadedDocsConfig = {
  /** The authored config, with deprecated aliases folded onto canonical names. */
  config: DocsConfig;
  path: string;
  /** The resolved project: collections, source graph, provenance, deprecations. */
  resolved: ResolvedDocsConfig;
  /** Non-fatal validation findings — unknown keys and the like. */
  warnings?: ConfigWarning[];
};

/**
 * Top-level `DocsConfig` keys, for unknown-key detection. Deliberately a
 * hand-maintained list: the type is erased at runtime, and an untyped
 * `.js`/`.mjs` config — or one written by an agent — is exactly the case
 * where a typo'd key would otherwise vanish silently.
 */
const defineCompleteKeys =
  <ObjectType>() =>
  <const Keys extends readonly (keyof ObjectType)[]>(
    keys: Exclude<keyof ObjectType, Keys[number]> extends never ? Keys : never
  ): Keys =>
    keys;

const TOP_LEVEL_CONFIG_KEYS = defineCompleteKeys<DocsConfig>()([
  "product",
  "baseUrl",
  "organization",
  "llms",
  "frontmatterSchema",
  "transformers",
  "flatteners",
  "groups",
  "navigation",
  "mounts",
  "feeds",
  "collections",
  "sources",
  "openapi",
  "i18n",
  "typeTableBasePath",
  "typeTableStrict",
  "git",
  "agents",
  "redirects",
  "lint",
] as const);

const COLLECTION_KEYS = [
  "repository",
  "ref",
  "cacheDir",
  "sparse",
  "sourceConfig",
  "inheritConfig",
  "dir",
  "include",
  "exclude",
  "prefix",
  "routePrefix",
  "schema",
  "frontmatterSchema",
  "groups",
  "navigation",
  "mounts",
  "flatteners",
] as const satisfies readonly (keyof DocsCollection)[];

// `kind` is the gitSource() brand, present on every spec by construction.
const GIT_SOURCE_KEYS = [
  "kind",
  "repository",
  "ref",
  "cacheDir",
  "sparse",
  "inheritConfig",
  "collections",
] as const satisfies readonly (keyof GitSourceSpec)[];

const NAV_NODE_KEYS = [
  "title",
  "slug",
  "description",
  "base",
  "pages",
  "children",
  "optional",
] as const;

const NAV_INCLUDE_KEYS = [
  "include",
  "exclude",
  "sort",
  "required",
  "pin",
] as const;

/** The known key a typo'd key is plausibly a misspelling of, if any. */
function closestKnownKey(
  key: string,
  allowed: readonly string[]
): string | undefined {
  const lowered = key.toLowerCase();
  const caseMatch = allowed.find(
    (candidate) => candidate.toLowerCase() === lowered
  );
  if (caseMatch) {
    return caseMatch;
  }
  // Short keys need a tight bound or everything is close to everything.
  const maxDistance = key.length <= 4 ? 1 : 2;
  // Widen a step at a time: one pass at the full bound returns whichever
  // candidate is listed first, not the closest one — `prefx` would suggest
  // "ref" (distance 2, listed early) over "prefix" (distance 1).
  for (let bound = 1; bound <= maxDistance; bound += 1) {
    const match = allowed.find((candidate) =>
      editDistanceWithin(lowered, candidate.toLowerCase(), bound)
    );
    if (match) {
      return match;
    }
  }
  return;
}

/**
 * Warn — never throw — about keys outside `allowed`. Unknown keys stay
 * accepted for forward compatibility (an older CLI reading a newer config
 * must not refuse it), but silence is what turns `navigatoin:` into a nav
 * tree that quietly reverts to inferred.
 */
function warnUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  fieldPath: string,
  configPath: string,
  warnings: ConfigWarning[] | undefined,
  /** What the file is, for the message — a host config or a source config. */
  context = "docs config"
): void {
  if (!warnings) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) {
      continue;
    }
    const owner = fieldPath ? `${fieldPath}.${key}` : key;
    const suggestion = closestKnownKey(key, allowed);
    warnings.push({
      id: "config.unknown-key",
      message: `${context} at "${configPath}": unknown field "${owner}"${suggestion ? ` — did you mean "${suggestion}"?` : ""}`,
      owner,
      ...(suggestion
        ? { fix: `Rename "${key}" to "${suggestion}", or remove it.` }
        : {
            fix: `Remove "${key}", or check the field name against the DocsConfig reference.`,
          }),
    });
  }
}

/**
 * Walk authored navigation entries for unknown keys. Nav objects are the most
 * typo-prone surface after the top level — `childrens`, `pin` vs `pins` — and
 * a bad key here degrades to "entry ignored", which reads as a missing page.
 */
function warnUnknownNavKeys(
  entries: unknown,
  fieldPath: string,
  configPath: string,
  warnings: ConfigWarning[] | undefined,
  context?: string
): void {
  if (!(warnings && Array.isArray(entries))) {
    return;
  }
  for (const [index, entry] of entries.entries()) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    const entryPath = `${fieldPath}[${index}]`;
    if (typeof entry.include === "string") {
      warnUnknownKeys(
        entry,
        NAV_INCLUDE_KEYS,
        entryPath,
        configPath,
        warnings,
        context
      );
      continue;
    }
    warnUnknownKeys(
      entry,
      NAV_NODE_KEYS,
      entryPath,
      configPath,
      warnings,
      context
    );
    if (Array.isArray(entry.pages)) {
      warnUnknownNavKeys(
        entry.pages,
        `${entryPath}.pages`,
        configPath,
        warnings,
        context
      );
    }
    if (Array.isArray(entry.children)) {
      warnUnknownNavKeys(
        entry.children,
        `${entryPath}.children`,
        configPath,
        warnings,
        context
      );
    }
  }
}

/**
 * Unknown-key warnings for a source-owned config loaded through
 * `inheritConfig` — the same collector the host config goes through, aimed at
 * the source file. Without it a `navigatoin` typo in the source repo is
 * silently inert: inheritance supplies no navigation and the collection
 * quietly falls back to an inferred tree. The allowed set is the full
 * authored key set, not just the inheritable fields: the default source
 * config is the source repo's own `docs.config.*`, so `product` and friends
 * are legitimate there and flagging them would warn on every real source
 * repo.
 */
export function collectSourceConfigUnknownKeys(
  value: unknown,
  configPath: string,
  collectionKey: string
): ConfigWarning[] {
  if (!isPlainRecord(value)) {
    return [];
  }
  const warnings: ConfigWarning[] = [];
  const context = `source config for collection "${collectionKey}"`;
  warnUnknownKeys(
    value,
    TOP_LEVEL_CONFIG_KEYS,
    "",
    configPath,
    warnings,
    context
  );
  warnUnknownNavKeys(
    value.navigation,
    "navigation",
    configPath,
    warnings,
    context
  );
  return warnings;
}

function validateOptionalStringField(
  value: Record<string, unknown>,
  field: string,
  configPath: string
): void {
  if (value[field] !== undefined && typeof value[field] !== "string") {
    throw new Error(
      `docs config at "${configPath}": organization.${field} must be a string`
    );
  }
}

function validateOptionalStringArrayField(
  value: Record<string, unknown>,
  field: string,
  configPath: string
): void {
  const fieldValue = value[field];
  if (
    fieldValue !== undefined &&
    !(
      Array.isArray(fieldValue) &&
      fieldValue.every((item) => typeof item === "string")
    )
  ) {
    throw new Error(
      `docs config at "${configPath}": organization.${field} must be an array of strings`
    );
  }
}

// Reject keys outside `allowed` — these objects are spread verbatim into the
// JSON-LD output, so a typo would silently become an invalid Schema.org property.
function validateKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  fieldPath: string,
  configPath: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `docs config at "${configPath}": ${fieldPath}.${key} is not a supported field ` +
          `(expected one of: ${allowed.join(", ")})`
      );
    }
  }
}

const POSTAL_ADDRESS_FIELDS = [
  "streetAddress",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
] as const;

function validatePostalAddress(value: unknown, configPath: string): void {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": organization.address must be an object`
    );
  }
  validateKnownKeys(
    value,
    POSTAL_ADDRESS_FIELDS,
    "organization.address",
    configPath
  );
  for (const field of POSTAL_ADDRESS_FIELDS) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(
        `docs config at "${configPath}": organization.address.${field} must be a string`
      );
    }
  }
  if (POSTAL_ADDRESS_FIELDS.every((field) => value[field] === undefined)) {
    throw new Error(
      `docs config at "${configPath}": organization.address must include at least one field ` +
        `(${POSTAL_ADDRESS_FIELDS.join(", ")})`
    );
  }
}

function validateStringOrStringArray(
  value: unknown,
  fieldPath: string,
  configPath: string
): void {
  if (
    value !== undefined &&
    typeof value !== "string" &&
    !(Array.isArray(value) && value.every((item) => typeof item === "string"))
  ) {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath} must be a string or array of strings`
    );
  }
}

const CONTACT_POINT_FIELDS = [
  "contactType",
  "email",
  "telephone",
  "url",
  "areaServed",
  "availableLanguage",
] as const;

function validateContactPoint(
  value: unknown,
  configPath: string,
  index?: number
): void {
  const fieldPath =
    index === undefined
      ? "organization.contactPoint"
      : `organization.contactPoint[${index}]`;
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath} must be an object`
    );
  }
  validateKnownKeys(value, CONTACT_POINT_FIELDS, fieldPath, configPath);
  if (typeof value.contactType !== "string") {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath}.contactType must be a string`
    );
  }
  if (value.email === undefined && value.telephone === undefined) {
    throw new Error(
      `docs config at "${configPath}": ${fieldPath} must include email or telephone`
    );
  }
  for (const field of ["email", "telephone", "url"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(
        `docs config at "${configPath}": ${fieldPath}.${field} must be a string`
      );
    }
  }
  validateStringOrStringArray(
    value.areaServed,
    `${fieldPath}.areaServed`,
    configPath
  );
  validateStringOrStringArray(
    value.availableLanguage,
    `${fieldPath}.availableLanguage`,
    configPath
  );
}

function validateContactPoints(value: unknown, configPath: string): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, contactPoint] of value.entries()) {
      validateContactPoint(contactPoint, configPath, index);
    }
    return;
  }
  validateContactPoint(value, configPath);
}

function validateProductInfo(
  value: unknown,
  configPath: string
): ProductInfo | undefined {
  if (!isPlainRecord(value)) {
    return;
  }
  if (typeof value.name !== "string" || typeof value.tagline !== "string") {
    return;
  }
  if (value.docs !== undefined) {
    if (typeof value.docs !== "string" || !value.docs.trim()) {
      throw new Error(
        `docs config at "${configPath}": product.docs must be a non-empty string`
      );
    }
    validateApiCatalogHref(value.docs, "product.docs", configPath);
  }
  return value as ProductInfo;
}

function validateOrganization(
  value: unknown,
  configPath: string
): OrganizationInfo | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value) || typeof value.name !== "string") {
    throw new Error(
      `docs config at "${configPath}": organization must be an object with a string name`
    );
  }
  if (value.url !== undefined && typeof value.url !== "string") {
    throw new Error(
      `docs config at "${configPath}": organization.url must be a string`
    );
  }
  validateOptionalStringField(value, "email", configPath);
  validateOptionalStringField(value, "logo", configPath);
  validateOptionalStringArrayField(value, "sameAs", configPath);
  validateContactPoints(value.contactPoint, configPath);
  validatePostalAddress(value.address, configPath);
  return value as OrganizationInfo;
}

function validateLlmsConfig(
  value: unknown,
  configPath: string
): DocsLlmsConfig | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}": llms must be an object`);
  }
  if (value.sections !== undefined && !Array.isArray(value.sections)) {
    throw new Error(
      `docs config at "${configPath}": llms.sections must be an array`
    );
  }
  return value as DocsLlmsConfig;
}

function validateAgentEndpoint(
  value: unknown,
  field: string,
  configPath: string,
  options: {
    allowEmptyDefault?: boolean;
  } = {}
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    throw new Error(
      `docs config at "${configPath}": ${field} must be a string`
    );
  }
  if (hasAsciiControlCharacter(value)) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not contain ASCII control characters`
    );
  }
  if (value.includes("\\")) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not contain backslashes`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (options.allowEmptyDefault && value === "") {
      return;
    }
    throw new Error(
      `docs config at "${configPath}": ${field} must not be empty`
    );
  }
  if (trimmed.startsWith("//")) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not be protocol-relative`
    );
  }
  const isHttpUrl = /^https?:\/\//i.test(trimmed);
  if (URI_SCHEME_PATTERN.test(trimmed) && !isHttpUrl) {
    throw new Error(
      `docs config at "${configPath}": ${field} must be an HTTP(S) URL or path`
    );
  }
  if (isHttpUrl) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(
        `docs config at "${configPath}": ${field} must be a valid absolute URL`
      );
    }
    if (parsed.username || parsed.password) {
      throw new Error(
        `docs config at "${configPath}": ${field} must not include a username or password`
      );
    }
  }
  if (INVALID_PERCENT_ESCAPE_PATTERN.test(value)) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not contain a malformed percent escape`
    );
  }
}

const API_CATALOG_LINK_FIELDS = [
  "serviceDesc",
  "serviceDoc",
  "serviceMeta",
  "status",
] as const;
const ASCII_CONTROL_MAX_CODE_POINT = 0x1f;
const ASCII_DELETE_CODE_POINT = 0x7f;
const INVALID_PERCENT_ESCAPE_PATTERN = /%(?![0-9a-f]{2})/i;
const ROOTLESS_AUTHORITY_URL_PATTERN = /^(?:https?|wss?|ftp):(?!\/\/)/i;
const ROOTLESS_FILE_URL_PATTERN = /^file:(?!\/)/i;

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= ASCII_CONTROL_MAX_CODE_POINT ||
      codePoint === ASCII_DELETE_CODE_POINT
    ) {
      return true;
    }
  }
  return false;
}

function validateApiCatalogHref(
  href: string,
  field: string,
  configPath: string
): void {
  if (hasAsciiControlCharacter(href)) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not contain ASCII control characters`
    );
  }
  if (hasUnpairedUtf16Surrogate(href)) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not contain unpaired UTF-16 surrogates`
    );
  }
  if (href.includes("\\")) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not contain backslashes`
    );
  }
  if (INVALID_PERCENT_ESCAPE_PATTERN.test(href)) {
    throw new Error(
      `docs config at "${configPath}": ${field} must not contain a malformed percent escape`
    );
  }
  if (
    ROOTLESS_AUTHORITY_URL_PATTERN.test(href.trim()) ||
    ROOTLESS_FILE_URL_PATTERN.test(href.trim())
  ) {
    throw new Error(
      `docs config at "${configPath}": ${field} must use the required slashes after its URL scheme`
    );
  }
  try {
    new URL(href.trim(), "https://leadtype.invalid/");
  } catch {
    throw new Error(
      `docs config at "${configPath}": ${field} must have a valid href`
    );
  }
}

function validateApiCatalogLink(
  value: unknown,
  field: string,
  configPath: string
): void {
  const isList = Array.isArray(value);
  const links = isList ? value : [value];
  for (const [index, link] of links.entries()) {
    const linkField = isList ? `${field}[${index}]` : field;
    if (
      !isPlainRecord(link) ||
      typeof link.href !== "string" ||
      link.href.trim().length === 0
    ) {
      throw new Error(
        `docs config at "${configPath}": ${linkField} must be a link (or array of links) with a non-empty href`
      );
    }
    validateApiCatalogHref(link.href, linkField, configPath);
    for (const attribute of ["type", "title"] as const) {
      if (
        link[attribute] !== undefined &&
        typeof link[attribute] !== "string"
      ) {
        throw new Error(
          `docs config at "${configPath}": ${linkField}.${attribute} must be a string`
        );
      }
    }
    if (typeof link.type === "string" && !isAsciiMediaType(link.type)) {
      throw new Error(
        `docs config at "${configPath}": ${linkField}.type must be a valid ASCII media type`
      );
    }
  }
}

/**
 * `agents.apis` reaches the generated RFC 9727 catalog verbatim, so a
 * malformed entry must fail at config load rather than emit a catalog that
 * lists a broken API.
 */
function validateApisConfig(value: unknown, configPath: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `docs config at "${configPath}": agents.apis must be an array`
    );
  }
  for (const [index, api] of value.entries()) {
    const field = `agents.apis[${index}]`;
    if (
      !isPlainRecord(api) ||
      typeof api.href !== "string" ||
      api.href.trim().length === 0
    ) {
      throw new Error(
        `docs config at "${configPath}": ${field} must be an object with a non-empty href`
      );
    }
    validateApiCatalogHref(api.href, field, configPath);
    for (const attribute of ["title", "type", "version"] as const) {
      if (api[attribute] !== undefined && typeof api[attribute] !== "string") {
        throw new Error(
          `docs config at "${configPath}": ${field}.${attribute} must be a string`
        );
      }
    }
    if (typeof api.type === "string" && !isAsciiMediaType(api.type)) {
      throw new Error(
        `docs config at "${configPath}": ${field}.type must be a valid ASCII media type`
      );
    }
    for (const relation of API_CATALOG_LINK_FIELDS) {
      if (api[relation] !== undefined) {
        validateApiCatalogLink(
          api[relation],
          `${field}.${relation}`,
          configPath
        );
      }
    }
  }
}

/**
 * The generated OpenAPI document overwrites whatever sits at its output path,
 * so an unsafe path has to fail at config load — a build that discovers it has
 * already clobbered a live artifact.
 */
function validateNlwebOpenApiConfig(value: unknown, configPath: string): void {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": agents.nlweb.openapi must be an object`
    );
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(
      `docs config at "${configPath}": agents.nlweb.openapi.enabled must be a boolean`
    );
  }
  for (const field of ["url", "output"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(
        `docs config at "${configPath}": agents.nlweb.openapi.${field} must be a string`
      );
    }
  }
  try {
    resolveNlwebOpenApiConfig(value as NlwebOpenApiConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`docs config at "${configPath}": ${message}`);
  }
}

function validateAgentsConfig(
  value: unknown,
  configPath: string
): DocsConfig["agents"] | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}": agents must be an object`);
  }
  // The mcp/nlweb endpoints reach resolveMcpEndpoint() and the tool names feed
  // the server card, so malformed values must fail here, not at generate time.
  const mcp = value.mcp;
  if (mcp !== undefined) {
    if (!isPlainRecord(mcp)) {
      throw new Error(
        `docs config at "${configPath}": agents.mcp must be an object`
      );
    }
    validateAgentEndpoint(mcp.endpoint, "agents.mcp.endpoint", configPath, {
      allowEmptyDefault: true,
    });
    if (mcp.icon !== undefined && typeof mcp.icon !== "string") {
      throw new Error(
        `docs config at "${configPath}": agents.mcp.icon must be a string`
      );
    }
    if (mcp.logo !== undefined && typeof mcp.logo !== "string") {
      throw new Error(
        `docs config at "${configPath}": agents.mcp.logo must be a string`
      );
    }
    if (mcp.serverInfo !== undefined) {
      if (!isPlainRecord(mcp.serverInfo)) {
        throw new Error(
          `docs config at "${configPath}": agents.mcp.serverInfo must be an object`
        );
      }
      for (const field of [
        "name",
        "version",
        "description",
        "instructions",
      ] as const) {
        if (
          mcp.serverInfo[field] !== undefined &&
          typeof mcp.serverInfo[field] !== "string"
        ) {
          throw new Error(
            `docs config at "${configPath}": agents.mcp.serverInfo.${field} must be a string`
          );
        }
      }
    }
    if (mcp.tools !== undefined) {
      const allowed = new Set<string>(DOCS_TOOL_NAMES);
      if (
        !Array.isArray(mcp.tools) ||
        mcp.tools.some((tool) => typeof tool !== "string" || !allowed.has(tool))
      ) {
        throw new Error(
          `docs config at "${configPath}": agents.mcp.tools must be an array of ${DOCS_TOOL_NAMES.join(", ")}`
        );
      }
    }
  }
  const nlweb = value.nlweb;
  if (nlweb !== undefined) {
    if (!isPlainRecord(nlweb)) {
      throw new Error(
        `docs config at "${configPath}": agents.nlweb must be an object`
      );
    }
    if (nlweb.endpoint !== undefined) {
      if (typeof nlweb.endpoint !== "string") {
        throw new Error(
          `docs config at "${configPath}": agents.nlweb.endpoint must be a string`
        );
      }
      try {
        assertSafeNlwebAskEndpoint(nlweb.endpoint, "agents.nlweb.endpoint");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`docs config at "${configPath}": ${message}`);
      }
    }
    validateNlwebOpenApiConfig(nlweb.openapi, configPath);
  }
  validateApisConfig(value.apis, configPath);
  return value as DocsConfig["agents"];
}

function validateDocsFeeds(
  value: unknown,
  configPath: string
): DocsFeedConfig[] | undefined {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`docs config at "${configPath}": feeds must be an array`);
  }
  const seen = new Set<string>();
  const seenOutputs = new Set<string>();
  for (const feed of value) {
    if (!isPlainRecord(feed)) {
      throw new Error(
        `docs config at "${configPath}": feed entries must be objects`
      );
    }
    if (typeof feed.id !== "string" || feed.id.length === 0) {
      throw new Error(
        `docs config at "${configPath}": feed entries must set a non-empty id`
      );
    }
    if (seen.has(feed.id)) {
      throw new Error(
        `docs config at "${configPath}": duplicate feed id "${feed.id}"`
      );
    }
    seen.add(feed.id);
    if (typeof feed.title !== "string" || feed.title.length === 0) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" must set a non-empty title`
      );
    }
    if (
      feed.description !== undefined &&
      typeof feed.description !== "string"
    ) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" description must be a string`
      );
    }
    if (
      !isPlainRecord(feed.source) ||
      typeof feed.source.urlPrefix !== "string" ||
      !feed.source.urlPrefix.startsWith("/")
    ) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" source.urlPrefix must start with "/"`
      );
    }
    if (!Array.isArray(feed.formats) || feed.formats.length === 0) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" formats must be a non-empty array`
      );
    }
    for (const format of feed.formats) {
      if (typeof format !== "string" || !FEED_FORMAT_VALUES.has(format)) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" formats must contain only "rss" or "atom"`
        );
      }
    }
    if (!isPlainRecord(feed.output)) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" output must be an object`
      );
    }
    for (const format of feed.formats) {
      const output = feed.output[format];
      if (typeof output !== "string" || !output.startsWith("/")) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" output.${format} must start with "/"`
        );
      }
      if (!output.endsWith(".xml")) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" output.${format} must end with ".xml" so feeds cannot overwrite other generated artifacts`
        );
      }
      if (seenOutputs.has(output)) {
        throw new Error(
          `docs config at "${configPath}": feed "${feed.id}" output.${format} "${output}" is already used by another feed output; output paths must be unique`
        );
      }
      seenOutputs.add(output);
    }
    if (
      feed.limit !== undefined &&
      (typeof feed.limit !== "number" ||
        !Number.isInteger(feed.limit) ||
        feed.limit <= 0)
    ) {
      throw new Error(
        `docs config at "${configPath}": feed "${feed.id}" limit must be a positive integer`
      );
    }
  }
  return value as DocsFeedConfig[];
}

function validateNlwebOpenApiFeedOutputs(
  agents: DocsConfig["agents"] | undefined,
  feeds: DocsFeedConfig[] | undefined,
  configPath: string
): void {
  if (agents?.nlweb?.enabled !== true || !feeds?.length) {
    return;
  }
  const openapi = resolveNlwebOpenApiConfig(agents.nlweb.openapi);
  if (!openapi) {
    return;
  }
  const openapiOutput = openapi.output.toLowerCase();
  for (const feed of feeds) {
    for (const format of feed.formats) {
      const authoredFeedOutput = feed.output[format];
      if (!authoredFeedOutput) {
        continue;
      }
      const feedOutput = path.posix
        .normalize(normalizeDocsPath(authoredFeedOutput).replace(/^\/+/, ""))
        .toLowerCase();
      const pathsConflict =
        openapiOutput === feedOutput ||
        openapiOutput.startsWith(`${feedOutput}/`) ||
        feedOutput.startsWith(`${openapiOutput}/`);
      if (pathsConflict) {
        throw new Error(
          `docs config at "${configPath}": agents.nlweb.openapi.output "${openapi.output}" conflicts with feed "${feed.id}" output.${format} "${authoredFeedOutput}"; generated output paths must not be equal, ancestors, or descendants`
        );
      }
    }
  }
}

function validateSourceConfigInheritance(
  value: unknown,
  configPath: string,
  collectionKey: string,
  /** The field name as authored, so the error points at the user's own line. */
  fieldName: string
): void {
  if (value === undefined || typeof value === "boolean") {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": collection "${collectionKey}" ${fieldName} must be a boolean or an object`
    );
  }
  if (
    value.path !== undefined &&
    (typeof value.path !== "string" || value.path.length === 0)
  ) {
    throw new Error(
      `docs config at "${configPath}": collection "${collectionKey}" ${fieldName}.path must be a non-empty string`
    );
  }
  if (value.inherit !== undefined) {
    if (!isStringArray(value.inherit)) {
      throw new Error(
        `docs config at "${configPath}": collection "${collectionKey}" ${fieldName}.inherit must be an array of supported field names`
      );
    }
    for (const field of value.inherit) {
      if (
        !SOURCE_CONFIG_INHERIT_FIELDS.has(field as SourceConfigInheritField)
      ) {
        throw new Error(
          `docs config at "${configPath}": collection "${collectionKey}" ${fieldName}.inherit contains unsupported field "${field}"`
        );
      }
    }
  }
}

function validateCollections(
  value: unknown,
  configPath: string,
  warnings?: ConfigWarning[],
  /** Field path collections live under, for grouped-source warnings. */
  fieldPathPrefix = "collections"
): Record<string, DocsCollection> | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}" must export "collections" as an object map`
    );
  }
  const out: Record<string, DocsCollection> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isPlainRecord(entry)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" must be an object`
      );
    }
    warnUnknownKeys(
      entry,
      COLLECTION_KEYS,
      `${fieldPathPrefix}.${key}`,
      configPath,
      warnings
    );
    warnUnknownNavKeys(
      entry.navigation,
      `${fieldPathPrefix}.${key}.navigation`,
      configPath,
      warnings
    );
    if (typeof entry.dir !== "string" || entry.dir.length === 0) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" must set "dir" to a non-empty string`
      );
    }
    if (
      entry.repository !== undefined &&
      typeof entry.repository !== "string"
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" repository must be a string`
      );
    }
    // Guard against args that would be parsed as git options when spawned
    // (e.g. a `repository` like `--upload-pack=…` injecting flags).
    if (
      typeof entry.repository === "string" &&
      entry.repository.startsWith("-")
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" repository must not begin with "-"`
      );
    }
    if (entry.ref !== undefined && typeof entry.ref !== "string") {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" ref must be a string`
      );
    }
    if (typeof entry.ref === "string" && entry.ref.startsWith("-")) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" ref must not begin with "-"`
      );
    }
    // `prefix`/`routePrefix` and `sourceConfig`/`inheritConfig` are the same
    // field under two names. Both spellings validate identically here; the
    // normalizer folds them together and rejects setting both.
    for (const field of ["prefix", "routePrefix"] as const) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        throw new Error(
          `docs config at "${configPath}": collection "${key}" ${field} must be a string`
        );
      }
    }
    for (const field of ["sourceConfig", "inheritConfig"] as const) {
      if (entry[field] !== undefined && entry.repository === undefined) {
        throw new Error(
          `docs config at "${configPath}": collection "${key}" ${field} is only supported for remote collections`
        );
      }
      validateSourceConfigInheritance(entry[field], configPath, key, field);
    }
    if (
      entry.groups !== undefined &&
      validateDocsGroups(entry.groups) === undefined
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" groups must be an array of { slug, title } entries`
      );
    }
    if (
      entry.navigation !== undefined &&
      validateDocsNav(entry.navigation) === undefined
    ) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" navigation must be an array of page entries or navigation nodes`
      );
    }
    if (entry.mounts !== undefined) {
      validateDocsMounts(entry.mounts, configPath);
    }
    if (entry.include !== undefined && !isStringArray(entry.include)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" include must be an array of glob strings`
      );
    }
    if (entry.exclude !== undefined && !isStringArray(entry.exclude)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" exclude must be an array of glob strings`
      );
    }
    if (entry.sparse !== undefined) {
      if (!isStringArray(entry.sparse)) {
        throw new Error(
          `docs config at "${configPath}": collection "${key}" sparse must be an array of repository-relative paths`
        );
      }
      if (entry.repository === undefined) {
        throw new Error(
          `docs config at "${configPath}": collection "${key}" sparse is only supported for remote collections`
        );
      }
      // Passed to `git sparse-checkout set` — a leading "-" would be read as a
      // flag, and an absolute path escapes the checkout entirely.
      for (const sparsePath of entry.sparse) {
        if (sparsePath.startsWith("-") || path.isAbsolute(sparsePath)) {
          throw new Error(
            `docs config at "${configPath}": collection "${key}" sparse path "${sparsePath}" must be a relative path that does not begin with "-"`
          );
        }
      }
    }
    if (entry.flatteners !== undefined && !Array.isArray(entry.flatteners)) {
      throw new Error(
        `docs config at "${configPath}": collection "${key}" flatteners must be an array of remark plugins`
      );
    }
    out[key] = entry as DocsCollection;
  }
  return out;
}

/**
 * Validate `sources` by checking the source-owned acquisition fields, then
 * reusing the collection validator on each child with the source's fields
 * cascaded in — so a grouped config and its flat equivalent produce identical
 * errors instead of two dialects of the same message.
 */
function validateGitSources(
  value: unknown,
  configPath: string,
  warnings?: ConfigWarning[]
): Record<string, GitSourceSpec> | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}" must export "sources" as an object map`
    );
  }
  for (const [sourceId, entry] of Object.entries(value)) {
    if (!isGitSourceSpec(entry)) {
      throw new Error(
        `docs config at "${configPath}": source "${sourceId}" must be built with gitSource({ … }).`
      );
    }
    warnUnknownKeys(
      entry,
      GIT_SOURCE_KEYS,
      `sources.${sourceId}`,
      configPath,
      warnings
    );
    if (typeof entry.repository !== "string" || entry.repository.length === 0) {
      throw new Error(
        `docs config at "${configPath}": source "${sourceId}" must set "repository" to a non-empty string`
      );
    }
    if (entry.repository.startsWith("-")) {
      throw new Error(
        `docs config at "${configPath}": source "${sourceId}" repository must not begin with "-"`
      );
    }
    if (entry.ref !== undefined && typeof entry.ref !== "string") {
      throw new Error(
        `docs config at "${configPath}": source "${sourceId}" ref must be a string`
      );
    }
    if (typeof entry.ref === "string" && entry.ref.startsWith("-")) {
      throw new Error(
        `docs config at "${configPath}": source "${sourceId}" ref must not begin with "-"`
      );
    }
    if (!isPlainRecord(entry.collections)) {
      throw new Error(
        `docs config at "${configPath}": source "${sourceId}" must export "collections" as an object map`
      );
    }
    validateSourceConfigInheritance(
      entry.inheritConfig,
      configPath,
      sourceId,
      "inheritConfig"
    );
    // Children inherit `repository` at expansion time, and the collection
    // validator rejects `inheritConfig` on a local collection — so cascade it
    // here to validate the shape the project will actually run.
    // A `.js`/`.mjs`/`.cjs` config has no type checking, which is why this
    // validator exists — so a child setting an acquisition field the source
    // owns has to be rejected here rather than silently cascaded over.
    for (const [key, child] of Object.entries(entry.collections)) {
      if (!isPlainRecord(child)) {
        continue;
      }
      // Indexed through a record view: the type omits these fields, which is
      // exactly why an untyped config can still carry them.
      const childRecord = child as Record<string, unknown>;
      for (const owned of ["repository", "ref", "cacheDir", "sparse"]) {
        if (childRecord[owned] !== undefined) {
          throw new Error(
            `docs config at "${configPath}": collection "${key}" sets "${owned}", which its source "${sourceId}" owns. Move it onto the gitSource, or declare the collection in the flat "collections" map instead.`
          );
        }
      }
    }
    const cascaded = Object.fromEntries(
      Object.entries(entry.collections).map(([key, child]) => [
        key,
        {
          ...(child as Record<string, unknown>),
          repository: entry.repository,
          ...(entry.sparse === undefined ? {} : { sparse: entry.sparse }),
        },
      ])
    );
    validateCollections(
      cascaded,
      configPath,
      warnings,
      `sources.${sourceId}.collections`
    );
  }
  return value as Record<string, GitSourceSpec>;
}

function validateGitConfig(
  value: unknown,
  configPath: string
): DocsConfig["git"] | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}": git must be an object`);
  }
  if (
    value.ignoredAuthors !== undefined &&
    !isStringArray(value.ignoredAuthors)
  ) {
    throw new Error(
      `docs config at "${configPath}": git.ignoredAuthors must be an array of strings`
    );
  }
  return {
    ...(value.ignoredAuthors === undefined
      ? {}
      : { ignoredAuthors: value.ignoredAuthors }),
  };
}

function validateRedirectsConfig(
  value: unknown,
  configPath: string
): DocsConfig["redirects"] | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      `docs config at "${configPath}": redirects must be an object`
    );
  }
  if (value.lockfile !== undefined && typeof value.lockfile !== "string") {
    throw new Error(
      `docs config at "${configPath}": redirects.lockfile must be a string`
    );
  }
  if (value.removed !== undefined && !isStringArray(value.removed)) {
    throw new Error(
      `docs config at "${configPath}": redirects.removed must be an array of strings`
    );
  }
  return {
    ...(value.lockfile === undefined ? {} : { lockfile: value.lockfile }),
    ...(value.removed === undefined ? {} : { removed: value.removed }),
  };
}

const LINT_SEVERITY_VALUES = new Set(["off", "warn", "error"]);

function validateLintConfig(
  value: unknown,
  configPath: string
): DocsConfig["lint"] | undefined {
  if (value === undefined) {
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}": lint must be an object`);
  }
  if (value.ignore !== undefined && !isStringArray(value.ignore)) {
    throw new Error(
      `docs config at "${configPath}": lint.ignore must be an array of strings`
    );
  }
  if (
    value.unknownFieldSeverity !== undefined &&
    value.unknownFieldSeverity !== "warn" &&
    value.unknownFieldSeverity !== "error"
  ) {
    throw new Error(
      `docs config at "${configPath}": lint.unknownFieldSeverity must be "warn" or "error"`
    );
  }
  let rules: Record<string, "off" | "warn" | "error"> | undefined;
  if (value.rules !== undefined) {
    if (!isPlainRecord(value.rules)) {
      throw new Error(
        `docs config at "${configPath}": lint.rules must be an object`
      );
    }
    for (const [rule, severity] of Object.entries(value.rules)) {
      if (typeof severity !== "string" || !LINT_SEVERITY_VALUES.has(severity)) {
        throw new Error(
          `docs config at "${configPath}": lint.rules.${rule} must be "off", "warn", or "error"`
        );
      }
    }
    rules = value.rules as Record<string, "off" | "warn" | "error">;
  }
  let externalLinks: { ignore?: string[]; ttlHours?: number } | undefined;
  if (value.externalLinks !== undefined) {
    if (!isPlainRecord(value.externalLinks)) {
      throw new Error(
        `docs config at "${configPath}": lint.externalLinks must be an object`
      );
    }
    if (
      value.externalLinks.ignore !== undefined &&
      !isStringArray(value.externalLinks.ignore)
    ) {
      throw new Error(
        `docs config at "${configPath}": lint.externalLinks.ignore must be an array of strings`
      );
    }
    const ttlHours = value.externalLinks.ttlHours;
    if (
      ttlHours !== undefined &&
      (typeof ttlHours !== "number" ||
        !Number.isFinite(ttlHours) ||
        ttlHours < 0)
    ) {
      throw new Error(
        `docs config at "${configPath}": lint.externalLinks.ttlHours must be a non-negative finite number`
      );
    }
    externalLinks = value.externalLinks as {
      ignore?: string[];
      ttlHours?: number;
    };
  }
  let snippets: { typecheck?: boolean } | undefined;
  if (value.snippets !== undefined) {
    if (!isPlainRecord(value.snippets)) {
      throw new Error(
        `docs config at "${configPath}": lint.snippets must be an object`
      );
    }
    if (
      value.snippets.typecheck !== undefined &&
      typeof value.snippets.typecheck !== "boolean"
    ) {
      throw new Error(
        `docs config at "${configPath}": lint.snippets.typecheck must be a boolean`
      );
    }
    snippets = value.snippets as { typecheck?: boolean };
  }
  return {
    ...(value.ignore === undefined ? {} : { ignore: value.ignore }),
    ...(value.unknownFieldSeverity === undefined
      ? {}
      : {
          unknownFieldSeverity: value.unknownFieldSeverity as "warn" | "error",
        }),
    ...(rules ? { rules } : {}),
    ...(externalLinks ? { externalLinks } : {}),
    ...(snippets ? { snippets } : {}),
  };
}

export function validateDocsConfig(
  value: unknown,
  configPath: string,
  /**
   * Collector for non-fatal findings. Unknown keys warn rather than error so
   * a config written for a newer leadtype still loads — but they must not
   * vanish: in an untyped config, `navigatoin:` silently doing nothing is the
   * opposite of the "explain why" story. Deliberately open surfaces
   * (`frontmatterSchema` contents, `mounts` entries, `llms` sections, and the
   * separately validated `organization`/`agents`/`openapi`/`lint` objects)
   * are not walked.
   */
  warnings?: ConfigWarning[]
): DocsConfig {
  if (!isPlainRecord(value)) {
    throw new Error(`docs config at "${configPath}" must export an object`);
  }
  const product = validateProductInfo(value.product, configPath);
  if (!product) {
    throw new Error(
      `docs config at "${configPath}" must export product.name and product.tagline`
    );
  }

  warnUnknownKeys(value, TOP_LEVEL_CONFIG_KEYS, "", configPath, warnings);
  warnUnknownNavKeys(value.navigation, "navigation", configPath, warnings);

  const collections = validateCollections(
    value.collections,
    configPath,
    warnings
  );
  const sources = validateGitSources(value.sources, configPath, warnings);
  // A source group is a collections declaration in acquisition-first form, so
  // it participates in the same single-source / multi-source exclusivity.
  const isMultiSource = Boolean(collections || sources);
  const openapi = validateDocsOpenApiConfig(
    value.openapi,
    `docs config at "${configPath}"`
  );
  const hasGroups = value.groups !== undefined;
  const hasNav = value.navigation !== undefined;

  if (isMultiSource && hasGroups) {
    throw new Error(
      `docs config at "${configPath}" sets both "groups" and "collections"/"sources". Move groups into the relevant collection(s) — top-level groups is for the single-collection shape only.`
    );
  }
  if (isMultiSource && hasNav) {
    throw new Error(
      `docs config at "${configPath}" sets both "navigation" and "collections"/"sources". Move navigation into the relevant collection(s) — top-level navigation is for the single-collection shape only.`
    );
  }

  let groups: DocsGroup[] | undefined;
  let nav: DocsNavEntry[] | undefined;
  if (!isMultiSource) {
    // A config with identity and nothing else is the documented common path:
    // navigation and the llms.txt body are derived from the content tree until
    // they are authored. Requiring `groups` or `navigation` here would reject
    // the config `leadtype init` scaffolds.
    groups = validateDocsGroups(value.groups);
    nav = validateDocsNav(value.navigation);
    if (hasGroups && !groups) {
      throw new Error(
        `docs config at "${configPath}" must export groups as an array of { slug, title } entries`
      );
    }
    if (hasNav && !nav) {
      throw new Error(
        `docs config at "${configPath}" must export navigation as an array of page entries or navigation nodes`
      );
    }
  }

  if (value.baseUrl !== undefined && typeof value.baseUrl !== "string") {
    // URL-validity itself is checked by normalization, which both this loader
    // and directly-supplied configs run through — only the authored shape is
    // this function's job.
    throw new Error(`docs config at "${configPath}": baseUrl must be a string`);
  }

  const organization = validateOrganization(value.organization, configPath);
  const llms = validateLlmsConfig(value.llms, configPath);
  const agents = validateAgentsConfig(value.agents, configPath);
  const mounts = validateDocsMounts(value.mounts, configPath);
  const feeds = validateDocsFeeds(value.feeds, configPath);
  validateNlwebOpenApiFeedOutputs(agents, feeds, configPath);
  const git = validateGitConfig(value.git, configPath);
  const redirects = validateRedirectsConfig(value.redirects, configPath);
  const lint = validateLintConfig(value.lint, configPath);

  if (value.flatteners !== undefined && !Array.isArray(value.flatteners)) {
    throw new Error(
      `docs config at "${configPath}" must export flatteners as an array of remark plugins`
    );
  }

  return {
    ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
    ...(collections ? { collections } : {}),
    ...(sources ? { sources } : {}),
    ...(groups ? { groups } : {}),
    ...(nav ? { navigation: nav } : {}),
    ...(organization ? { organization } : {}),
    ...(llms ? { llms } : {}),
    ...(agents ? { agents } : {}),
    ...(mounts ? { mounts } : {}),
    ...(feeds ? { feeds } : {}),
    ...(git ? { git } : {}),
    ...(redirects ? { redirects } : {}),
    ...(lint ? { lint } : {}),
    ...(openapi ? { openapi } : {}),
    ...(value.frontmatterSchema === undefined
      ? {}
      : {
          frontmatterSchema: value.frontmatterSchema as DocsFrontmatterSchema,
        }),
    ...(value.transformers === undefined
      ? {}
      : { transformers: value.transformers as DocsTransformer[] }),
    ...(value.flatteners === undefined
      ? {}
      : { flatteners: value.flatteners as DocsConfig["flatteners"] }),
    ...(value.i18n === undefined
      ? {}
      : { i18n: value.i18n as DocsConfig["i18n"] }),
    product,
    typeTableBasePath:
      typeof value.typeTableBasePath === "string"
        ? value.typeTableBasePath
        : undefined,
    typeTableStrict:
      typeof value.typeTableStrict === "boolean"
        ? value.typeTableStrict
        : undefined,
  };
}

export async function loadDocsConfigFromDir(
  dir: string,
  filenames: readonly string[],
  options: { warn?: ConfigWarningSink } = {}
): Promise<LoadedDocsConfig | null> {
  const configPath = filenames
    .map((filename) => path.join(dir, filename))
    .find((candidate) => existsSync(candidate));

  if (!configPath) {
    return null;
  }

  try {
    const imported = await importConfigModule(configPath);
    // Validation checks the authored shape; normalization folds deprecated
    // aliases onto canonical names and derives the resolved project. Every
    // consumer downstream of here reads canonical fields only.
    const warnings: ConfigWarning[] = [];
    const { config, resolved } = normalizeDocsConfig(
      validateDocsConfig(imported, configPath, warnings),
      { configPath, configDir: path.dirname(configPath) }
    );
    const loaded: LoadedDocsConfig = {
      config,
      path: configPath,
      resolved,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    // Warn here rather than at each entry point: this *is* the config load, so
    // generate, sync, lint, and score all get the same one-time message.
    warnConfigDeprecations(loaded, options.warn);
    warnConfigUnknownKeys(loaded, options.warn);
    return loaded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to load docs config at "${configPath}": ${message}`
    );
  }
}

// Deprecation warnings are per config *file* per *sink*, not per process:
// `generate` reloading the same config in a watch loop reuses the process
// logger and should not stack warnings, but doctor and nav inject a fresh
// sink per run — a process-global set keyed on path alone meant the second
// resolve of the same config warned nobody, and for `nav` (whose report
// carries no diagnostics) the warning vanished entirely.
//
// The remembered key is the path *plus the rendered warning content*: watch
// mode reloads through the same long-lived sink, and a path-only key
// suppressed every later warning for the file — replace one typo with a
// different one and nothing prints until the process restarts. Content-keyed,
// an identical reload stays quiet while a changed warning set re-emits.
const warnedConfigPathsBySink = new WeakMap<ConfigWarningSink, Set<string>>();

function warnedKey(configPath: string, content: string[]): string {
  // NUL never appears in a path or a rendered message, so distinct sets
  // cannot collide into one key.
  return [configPath, ...content].join("\u0000");
}

function alreadyWarned(
  bySink: WeakMap<ConfigWarningSink, Set<string>>,
  warn: ConfigWarningSink,
  key: string
): boolean {
  return bySink.get(warn)?.has(key) ?? false;
}

function rememberWarned(
  bySink: WeakMap<ConfigWarningSink, Set<string>>,
  warn: ConfigWarningSink,
  key: string
): void {
  const keys = bySink.get(warn) ?? new Set<string>();
  bySink.set(warn, keys);
  keys.add(key);
}

/**
 * Emit one actionable deprecation warning per config file and sink. Safe to
 * call from every CLI entry point — repeat calls for the same file into the
 * same sink are dropped.
 *
 * The warning goes to `warn` — the caller's injected io when there is one —
 * never straight to the process streams: doctor and nav run with injected
 * streams, and a warning bypassing them interleaves with `--json` output and
 * leaks into test runners.
 */
export function warnConfigDeprecations(
  loaded: LoadedDocsConfig | null,
  warn: ConfigWarningSink = logger.warn
): void {
  if (!loaded) {
    return;
  }
  const key = warnedKey(
    loaded.path,
    loaded.resolved.deprecations.map((entry) => entry.field)
  );
  if (alreadyWarned(warnedConfigPathsBySink, warn, key)) {
    return;
  }
  const warning = formatDeprecationWarning(loaded.resolved.deprecations);
  if (!warning) {
    return;
  }
  rememberWarned(warnedConfigPathsBySink, warn, key);
  warn({
    human: {
      message: `${loaded.path}: ${warning.message}`,
      hint: warning.hint,
    },
    json: {
      event: "config.deprecated_fields",
      fields: {
        configPath: loaded.path,
        fields: loaded.resolved.deprecations.map((entry) => entry.field),
        replacements: loaded.resolved.deprecations.map(
          (entry) => entry.replacement
        ),
      },
    },
  });
}

// Same once-per-file-per-sink rule as deprecations, tracked separately so a
// config with both still reports both.
const warnedUnknownKeyPathsBySink = new WeakMap<
  ConfigWarningSink,
  Set<string>
>();

/** Emit one aggregated unknown-key warning per config file and sink. */
export function warnConfigUnknownKeys(
  loaded: LoadedDocsConfig | null,
  warn: ConfigWarningSink = logger.warn
): void {
  if (!loaded) {
    return;
  }
  emitUnknownKeyWarnings(loaded.path, loaded.warnings ?? [], warn);
}

/**
 * The emission behind {@link warnConfigUnknownKeys}, for warnings that belong
 * to a file other than the loaded config — a source-owned config read through
 * `inheritConfig`. Same aggregation, same once-per-content-per-sink rule.
 */
export function emitUnknownKeyWarnings(
  configPath: string,
  warnings: ConfigWarning[],
  warn: ConfigWarningSink = logger.warn
): void {
  const key = warnedKey(
    configPath,
    warnings.map((entry) => entry.message)
  );
  if (
    warnings.length === 0 ||
    alreadyWarned(warnedUnknownKeyPathsBySink, warn, key)
  ) {
    return;
  }
  rememberWarned(warnedUnknownKeyPathsBySink, warn, key);
  const fields = warnings.map((entry) => entry.owner);
  warn({
    human: {
      message: `${configPath}: ${warnings.length} unknown config field${warnings.length === 1 ? "" : "s"}: ${fields.join(", ")}`,
      hint:
        warnings.find((entry) => entry.fix)?.fix ??
        "Unknown fields are ignored. Remove them, or check the field names against the DocsConfig reference.",
    },
    json: {
      event: "config.unknown_keys",
      fields: { configPath, fields },
    },
  });
}

/**
 * Look for `leadtype.config.{ts,js,mjs,cjs}` in the given directory.
 * Used by the sync CLI; for `generate`, prefer {@link loadDocsConfig}.
 */
export async function loadLeadtypeConfig(
  cwd: string,
  options: { warn?: ConfigWarningSink } = {}
): Promise<LoadedDocsConfig | null> {
  return loadDocsConfigFromDir(cwd, LEADTYPE_CONFIG_FILENAMES, options);
}

/**
 * Locate and load the docs config. Lookup order:
 *   1. `leadtype.config.{ts,js,mjs,cjs}` at `cwd` (project root).
 *   2. `docs.config.{ts,js,mjs,cjs}` in each `docsDir` (legacy).
 *
 * The new `leadtype.config.*` filename is opt-in to project-level config;
 * the per-docs-dir `docs.config.*` lookup stays the same as before.
 */
export async function loadDocsConfig(opts: {
  cwd?: string;
  docsDirs: string[];
  warn?: ConfigWarningSink;
}): Promise<LoadedDocsConfig | null> {
  const options = { ...(opts.warn ? { warn: opts.warn } : {}) };
  if (opts.cwd) {
    const projectConfig = await loadDocsConfigFromDir(
      opts.cwd,
      LEADTYPE_CONFIG_FILENAMES,
      options
    );
    if (projectConfig) {
      return projectConfig;
    }
  }
  for (const docsDir of opts.docsDirs) {
    const loaded = await loadDocsConfigFromDir(
      docsDir,
      DOCS_CONFIG_FILENAMES,
      options
    );
    if (loaded) {
      return loaded;
    }
  }
  return null;
}
