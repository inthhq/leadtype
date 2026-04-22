import JSON5 from "json5";
import type { Code, Root, RootContent } from "mdast";
import type { Transformer } from "unified";
import {
  createJsxComponentProcessor,
  createParagraph,
  createStrongParagraph,
  getAttributeValue,
  normalizeWhitespace,
  processContentNode,
} from "../libs";

type SourceFile = {
  filename: string;
  language?: string;
  code: string;
};

function parseString(raw: string | null): string {
  if (!raw) {
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).replaceAll("\\`", "`").replaceAll("\\${", "${");
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON5.parse(trimmed);
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return raw;
}

function isSourceFile(value: unknown): value is SourceFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return typeof entry.filename === "string" && typeof entry.code === "string";
}

function parseSourceFiles(raw: string | null): SourceFile[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON5.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSourceFile).map((entry) => ({
      filename: entry.filename,
      language: typeof entry.language === "string" ? entry.language : undefined,
      code: entry.code,
    }));
  } catch {
    return [];
  }
}

function createCodeBlock(value: string, lang: string): Code {
  return {
    type: "code",
    lang,
    value,
  };
}

function processPreview(children: RootContent[]): RootContent[] {
  const result: RootContent[] = [];

  for (const child of children) {
    const processed = processContentNode(child);
    if (processed) {
      result.push(processed as RootContent);
    }
  }

  return result;
}

export function remarkExampleToMarkdown(): Transformer<Root, Root> {
  return createJsxComponentProcessor("Example", (node) => {
    const title = normalizeWhitespace(getAttributeValue(node, "title") ?? "");
    const description = normalizeWhitespace(
      getAttributeValue(node, "description") ?? ""
    );
    const filename = normalizeWhitespace(
      getAttributeValue(node, "filename") ?? ""
    );
    const language = normalizeWhitespace(
      getAttributeValue(node, "language") ?? "tsx"
    );
    const code = parseString(getAttributeValue(node, "code"));
    const sourceFiles = parseSourceFiles(
      getAttributeValue(node, "sourceFiles")
    );
    const replacement: RootContent[] = [];

    if (title) {
      replacement.push(createStrongParagraph(title));
    }

    if (description) {
      replacement.push(createParagraph(description));
    }

    replacement.push(...processPreview((node.children ?? []) as RootContent[]));

    if (filename) {
      replacement.push(createStrongParagraph(filename));
    }

    if (code) {
      replacement.push(createCodeBlock(code, language));
    }

    for (const sourceFile of sourceFiles) {
      replacement.push(createStrongParagraph(sourceFile.filename));
      replacement.push(
        createCodeBlock(sourceFile.code, sourceFile.language ?? language)
      );
    }

    return replacement;
  });
}
