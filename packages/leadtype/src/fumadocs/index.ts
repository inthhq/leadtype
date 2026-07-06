/**
 * `leadtype/fumadocs` — thin adapter mapping `createDocsSource()` output to
 * fumadocs-core's `Source` interface.
 *
 * Requires `fumadocs-core >= 15.0.0` as an optional peer dependency. Install
 * it alongside `leadtype` in your docs app:
 *
 * ```sh
 * bun add fumadocs-core leadtype
 * ```
 *
 * Then wire the source into fumadocs's `loader()`:
 *
 * ```ts
 * import { loader } from "fumadocs-core/source";
 * import { fumadocsSource } from "leadtype/fumadocs";
 *
 * export const source = loader({
 *   baseUrl: "/docs",
 *   source: await fumadocsSource({ contentDir: "./content/docs" }),
 * });
 * ```
 *
 * The adapter pre-walks `contentDir` at construction time so fumadocs sees a
 * synchronous list of files. Page bodies are loaded on demand via the
 * companion `loadPage()` helper, which you can call from a server component.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Source } from "fumadocs-core/source";
import { glob as fg } from "tinyglobby";
import {
  type CreateDocsSourceConfig,
  createDocsSource,
  type DocsPage,
  type DocsSource,
} from "../source";

/**
 * Page metadata fumadocs receives from this adapter. Extends fumadocs's
 * default `PageData` (icon/title/description) with leadtype's group slugs so
 * consumer sidebars can filter / group pages.
 */
export type LeadtypeFumadocsPageData = {
  title: string;
  description?: string;
  groups: string[];
};

/**
 * Meta entries fumadocs builds its page tree from. Mirrors fumadocs's default
 * `MetaData` so consumers can author `meta.json` files normally.
 */
export type LeadtypeFumadocsMetaData = {
  icon?: string;
  title?: string;
  root?: boolean;
  pages?: string[];
  defaultOpen?: boolean;
  description?: string;
};

export type LeadtypeFumadocsSourceConfig = {
  pageData: LeadtypeFumadocsPageData;
  metaData: LeadtypeFumadocsMetaData;
};

export type LeadtypeFumadocsSource = Source<LeadtypeFumadocsSourceConfig> & {
  /** The underlying `DocsSource` — call `loadPage`, `buildSearchIndex`, etc. */
  leadtype: DocsSource;
  /** Convenience: resolve a fumadocs page → leadtype `DocsPage`. */
  loadPage(slug: string | string[]): Promise<DocsPage | null>;
  /** Remove generated temp overlay files from the underlying source. */
  cleanup(): Promise<void>;
};

/**
 * Build a fumadocs-compatible Source from a leadtype docs directory.
 *
 * Walks both `.md`/`.mdx` pages **and** `meta.json` files under `contentDir`,
 * yielding fumadocs the same nav tree it would build from a colocated
 * fumadocs-mdx source. Set `includeMetaJson: false` to skip the meta walk if
 * you'd rather have fumadocs auto-build the tree from page slugs.
 *
 * @example
 *   const source = await fumadocsSource({ contentDir: "./content/docs" });
 *   const loader = loader({ baseUrl: "/docs", source });
 */
export async function fumadocsSource(
  config: CreateDocsSourceConfig & { includeMetaJson?: boolean }
): Promise<LeadtypeFumadocsSource> {
  const leadtype = await createDocsSource(config);
  const metas = await leadtype.listPages();

  const pageFiles = metas.map((meta) => ({
    type: "page" as const,
    path: `${meta.relativePath}${meta.extension}`,
    absolutePath: meta.filePath,
    slugs: meta.slug,
    data: {
      title: meta.title,
      description: meta.description || undefined,
      groups: meta.groups,
    } satisfies LeadtypeFumadocsPageData,
  }));

  const metaFiles =
    config.includeMetaJson === false
      ? []
      : await readMetaFiles(leadtype.contentDir);

  return {
    files: [...pageFiles, ...metaFiles],
    leadtype,
    loadPage: leadtype.loadPage,
    cleanup: leadtype.cleanup,
  };
}

async function readMetaFiles(contentDir: string): Promise<
  Array<{
    type: "meta";
    path: string;
    absolutePath: string;
    data: LeadtypeFumadocsMetaData;
  }>
> {
  const matches = await fg("**/meta.json", {
    absolute: true,
    cwd: contentDir,
    onlyFiles: true,
  });
  return await Promise.all(
    matches.map(async (filePath) => {
      const relativePath = path
        .relative(contentDir, filePath)
        .replaceAll(path.sep, "/");
      const raw = await readFile(filePath, "utf8");
      let data: LeadtypeFumadocsMetaData = {};
      try {
        const parsed = JSON.parse(raw) as unknown;
        // Only accept plain objects. Arrays, strings, numbers, null, etc.
        // are treated the same as malformed JSON — fumadocs expects an
        // object-shaped meta record, and passing it through would break
        // downstream consumers.
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          data = parsed as LeadtypeFumadocsMetaData;
        }
      } catch {
        // Malformed meta.json: keep the entry so fumadocs can surface a
        // helpful warning during page-tree building instead of silently
        // ignoring it.
      }
      return {
        type: "meta" as const,
        path: relativePath,
        absolutePath: filePath,
        data,
      };
    })
  );
}
