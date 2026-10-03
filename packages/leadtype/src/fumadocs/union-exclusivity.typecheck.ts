/**
 * Compile-time contract: the two arms of `FumadocsSourceConfig` are mutually
 * exclusive. This is deliberately *not* a `*.test.ts` file — the tsconfig
 * excludes those from `check-types` and vitest does not typecheck, so a
 * `@ts-expect-error` in a test asserts nothing. Living inside the normal
 * include set, this file fails `check-types` (and CI with it) the moment the
 * union stops rejecting mixed configs: an unused `@ts-expect-error` directive
 * is itself a compile error, so the assertion fails in both directions.
 */
import type { DocsSource } from "../source";
import type { FumadocsSourceConfig } from "./index";

declare const project: DocsSource;

// Each arm stands on its own.
export const withProject: FumadocsSourceConfig = { source: project };
export const withOptions: FumadocsSourceConfig = {
  source: project,
  includeMetaJson: false,
};
export const withDescription: FumadocsSourceConfig = {
  contentDir: "./docs",
  nav: [],
};

// A project mixed with source-description options must not compile. A plain
// union relaxes excess-property checking across members, so this once
// compiled and silently dropped `typeTableBasePath` — the quiet config drift
// that passing a project exists to end.
// @ts-expect-error — `typeTableBasePath` must not compile alongside `source`
export const mixed: FumadocsSourceConfig = {
  source: project,
  typeTableBasePath: "/x",
};
