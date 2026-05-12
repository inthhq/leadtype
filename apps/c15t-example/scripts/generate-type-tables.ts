#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTypeFromFile } from "../../../packages/leadtype/src/remark";

interface ExtractedTypeProperty {
  default?: string;
  deprecated?: boolean;
  description?: string;
  required?: boolean;
  type: string;
  typeDescription?: string;
  typeDescriptionLink?: string;
}

interface TypeTableRow extends ExtractedTypeProperty {
  name: string;
}

interface TypeTableRecord {
  key: string;
  name: string;
  path: string;
  rows: TypeTableRow[];
}

interface GenerateTypeTablesOptions {
  outFile: string;
  sourceRoot: string;
}

const autoTypeTableTagRegex = /<AutoTypeTable\b[^>]*>/g;
const attributeRegex = /\b(name|path)=["']([^"']+)["']/g;
const markdownExtensions = new Set([".md", ".mdx"]);

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = join(scriptsRoot, "..", "..", "..");
const defaultSourceRoot = join(defaultRepoRoot, ".docs-src", "c15t");
const defaultOutFile = join(
  defaultRepoRoot,
  "apps",
  "c15t-example",
  "public",
  "type-tables.json"
);

const typeTableKey = (path: string, name: string) => `${path}#${name}`;

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(entryPath)));
    } else if (markdownExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function extractAutoTypeTableReferences(source: string) {
  const references: Array<{ name: string; path: string }> = [];
  const tags = source.matchAll(autoTypeTableTagRegex);

  for (const tag of tags) {
    const attributes = new Map<string, string>();
    for (const attribute of tag[0].matchAll(attributeRegex)) {
      const key = attribute[1];
      const value = attribute[2];
      if (key && value) {
        attributes.set(key, value);
      }
    }

    const name = attributes.get("name");
    const path = attributes.get("path");
    if (name && path) {
      references.push({ name, path });
    }
  }

  return references;
}

async function findAutoTypeTableReferences(docsRoot: string) {
  const files = await collectMarkdownFiles(docsRoot);
  const references = new Map<string, { name: string; path: string }>();

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const reference of extractAutoTypeTableReferences(source)) {
      references.set(typeTableKey(reference.path, reference.name), reference);
    }
  }

  return [...references.values()].sort((left, right) =>
    typeTableKey(left.path, left.name).localeCompare(
      typeTableKey(right.path, right.name)
    )
  );
}

export async function generateTypeTables({
  outFile,
  sourceRoot,
}: GenerateTypeTablesOptions) {
  const docsRoot = join(sourceRoot, "docs");
  const tables: Record<string, TypeTableRecord> = {};

  if (!existsSync(docsRoot)) {
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(
      outFile,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), tables: {}, version: 1 }, null, 2)}\n`
    );
    return;
  }

  const references = await findAutoTypeTableReferences(docsRoot);

  for (const reference of references) {
    const extractedType = extractTypeFromFile(
      reference.path,
      reference.name,
      sourceRoot
    );
    if (!extractedType) {
      continue;
    }

    const key = typeTableKey(reference.path, reference.name);
    tables[key] = {
      key,
      name: reference.name,
      path: reference.path,
      rows: Object.entries(extractedType).map(([name, property]) => ({
        name,
        ...property,
      })),
    };
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(
    outFile,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tables,
        version: 1,
      },
      null,
      2
    )}\n`
  );
}

if (import.meta.main) {
  await generateTypeTables({
    outFile: defaultOutFile,
    sourceRoot: defaultSourceRoot,
  });
}
