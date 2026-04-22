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
  id?: string;
  filename: string;
  language?: string;
  code: string;
};

function decodeTemplateLiteralValue(value: string): string {
  let result = "";
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      if (character === "n") {
        result += "\n";
      } else if (character === "r") {
        result += "\r";
      } else if (character === "t") {
        result += "\t";
      } else {
        result += character;
      }
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    result += character;
  }

  return escaped ? `${result}\\` : result;
}

function readTemplateLiteral(
  input: string,
  startIndex: number
): { value: string; endIndex: number } | null {
  let current = "";
  let escaped = false;

  for (let index = startIndex + 1; index < input.length; index += 1) {
    const character = input[index];

    if (character === undefined) {
      return null;
    }

    if (escaped) {
      current += `\\${character}`;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === "`") {
      return {
        value: decodeTemplateLiteralValue(current),
        endIndex: index,
      };
    }

    current += character;
  }

  return null;
}

function templateLiteralsToJsonStrings(raw: string): string | null {
  let result = "";

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (character !== "`") {
      result += character;
      continue;
    }

    const literal = readTemplateLiteral(raw, index);
    if (!literal) {
      return null;
    }

    result += JSON.stringify(literal.value);
    index = literal.endIndex;
  }

  return result;
}

function parseString(raw: string | null): string {
  if (!raw) {
    return "";
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return decodeTemplateLiteralValue(trimmed.slice(1, -1));
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

  const hasRequiredKeys = "filename" in value && "code" in value;
  if (!hasRequiredKeys) {
    return false;
  }

  return typeof value.filename === "string" && typeof value.code === "string";
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
      id: typeof entry.id === "string" ? entry.id : undefined,
      filename: entry.filename,
      language: typeof entry.language === "string" ? entry.language : undefined,
      code: entry.code,
    }));
  } catch {
    const normalized = templateLiteralsToJsonStrings(raw);
    if (!normalized) {
      return [];
    }

    try {
      const parsed = JSON5.parse(normalized);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isSourceFile).map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : undefined,
        filename: entry.filename,
        language:
          typeof entry.language === "string" ? entry.language : undefined,
        code: entry.code,
      }));
    } catch {
      return [];
    }
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
