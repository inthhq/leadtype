const DIACRITIC_PATTERN = /[\u0300-\u036f]/g;
const FRONTMATTER_PATTERN = /^---\s*\n[\s\S]*?\n---\s*\n?/;
const HEADING_PATTERN = /^(#{1,6})(?:\s+(.*))?$/;
const SETEXT_H1_PATTERN = /^ {0,3}=+\s*$/;
const SETEXT_H2_PATTERN = /^ {0,3}-+\s*$/;
const FENCE_PATTERN = /^(`{3,}|~{3,})/;
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/;
const BLOCKQUOTE_PATTERN = /^ {0,3}>/;
const LIST_ITEM_PATTERN = /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$)/;
const HTML_BLOCK_START_PATTERN =
  /^ {0,3}(?:<(?:pre|script|style|textarea)(?:[ \t\r>]|$)|<!--|<\?|<![A-Za-z]|<!\[CDATA\[)/i;
const HTML_DECLARATION_START_PATTERN = /^<![A-Za-z]/;
// Dotted names intentionally follow MDX JSX semantics. Source extensions are
// discarded before this shared TOC/search scanner runs, so distinguishing
// plain Markdown would require threading syntax metadata through public APIs.
const HTML_OR_MDX_TAG_START_PATTERN =
  /^<\/?(?:[A-Za-z][A-Za-z0-9-]*|[_$][A-Za-z0-9_$]*|[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+)(?=[\t\n\f\r />])/;
export const docsHtmlBlockTagNames = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
] as const;
const HTML_BLOCK_TAG_PATTERN = new RegExp(
  `^ {0,3}</?(?:${docsHtmlBlockTagNames.join("|")})(?:[ \\t\\r]|/?>|$)`,
  "i"
);
const STANDALONE_HTML_TAG_PATTERN =
  /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>[ \t\r]*$/;
const MDX_BLOCK_START_PATTERN =
  /^ {0,3}(?:\{|<\/?>[ \t\r]*$|<\/?(?:[A-Z_$][A-Za-z0-9_$:-]*|[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+)(?:[ \t\r/>]|$))/;
const LINK_DEFINITION_PATTERN = /^ {0,3}\[[^\]]+\]:/;
const THEMATIC_BREAK_PATTERN =
  /^ {0,3}(?:(?:\*\s*){3,}|(?:_\s*){3,}|(?:-\s*){3,})$/;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const HEADING_INLINE_PATTERN = /[`*_~[\](){}|]/g;
const HEADING_CLOSING_SEQUENCE_PATTERN = /\s+#+\s*$/;
const WHITESPACE_PATTERN = /\s+/g;

const normalizeHeadingText = (input: string): string =>
  input.normalize("NFKD").replace(DIACRITIC_PATTERN, "").toLowerCase();

type HtmlConstruct =
  | { closingSequence: "-->" | "?>" | "]]>"; tracksQuotes: false }
  | { closingSequence: ">"; tracksQuotes: boolean };

function getHtmlConstruct(input: string): HtmlConstruct | null {
  if (input.startsWith("<!--")) {
    return { closingSequence: "-->", tracksQuotes: false };
  }
  if (input.startsWith("<?")) {
    return { closingSequence: "?>", tracksQuotes: false };
  }
  if (input.startsWith("<![CDATA[")) {
    return { closingSequence: "]]>", tracksQuotes: false };
  }
  if (HTML_DECLARATION_START_PATTERN.test(input)) {
    return { closingSequence: ">", tracksQuotes: false };
  }
  if (
    input.startsWith("<>") ||
    input.startsWith("</>") ||
    HTML_OR_MDX_TAG_START_PATTERN.test(input)
  ) {
    return { closingSequence: ">", tracksQuotes: true };
  }
  return null;
}

function findHtmlConstructEnd(
  input: string,
  start: number,
  construct: HtmlConstruct
): number {
  if (!construct.tracksQuotes) {
    const closingIndex = input.indexOf(construct.closingSequence, start);
    return closingIndex < 0
      ? -1
      : closingIndex + construct.closingSequence.length;
  }

  let quote: '"' | "'" | null = null;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      return index + 1;
    }
  }
  return -1;
}

function stripHtmlTags(input: string): string {
  const output: string[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const tagStart = input.indexOf("<", cursor);
    if (tagStart < 0) {
      output.push(input.slice(cursor));
      break;
    }
    output.push(input.slice(cursor, tagStart));
    const construct = getHtmlConstruct(input.slice(tagStart));
    if (!construct) {
      output.push("<");
      cursor = tagStart + 1;
      continue;
    }
    const constructEnd = findHtmlConstructEnd(input, tagStart, construct);
    if (constructEnd < 0) {
      output.push(input.slice(tagStart));
      break;
    }
    output.push(" ");
    cursor = constructEnd;
  }

  return output.join("");
}

function cleanHeadingText(input: string): string {
  return stripHtmlTags(input.replace(HEADING_CLOSING_SEQUENCE_PATTERN, ""))
    .replace(MARKDOWN_LINK_PATTERN, "$1")
    .replace(HEADING_INLINE_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

function isHtmlOrMdxBlock(line: string): boolean {
  return (
    HTML_BLOCK_START_PATTERN.test(line) ||
    HTML_BLOCK_TAG_PATTERN.test(line) ||
    STANDALONE_HTML_TAG_PATTERN.test(line) ||
    MDX_BLOCK_START_PATTERN.test(line)
  );
}

function isSetextHeadingText(line: string): boolean {
  if (line.trim().length === 0) {
    return false;
  }

  return !(
    INDENTED_CODE_PATTERN.test(line) ||
    BLOCKQUOTE_PATTERN.test(line) ||
    LIST_ITEM_PATTERN.test(line) ||
    isHtmlOrMdxBlock(line) ||
    LINK_DEFINITION_PATTERN.test(line) ||
    THEMATIC_BREAK_PATTERN.test(line)
  );
}

export type DocsMarkdownToken =
  | { kind: "code"; value: string }
  | { kind: "heading"; level: number; title: string }
  | { kind: "text"; value: string };

/** Tokenize the markdown constructs that affect page heading allocation. */
export function scanDocsMarkdown(content: string): DocsMarkdownToken[] {
  const tokens: DocsMarkdownToken[] = [];
  const pendingTextLines: string[] = [];
  let pendingSetextTitle: string | null = null;
  let activeFenceCharacter: "`" | "~" | null = null;
  let activeFenceLength = 0;

  const flushPendingText = (): void => {
    for (const value of pendingTextLines) {
      tokens.push({ kind: "text", value });
    }
    pendingTextLines.length = 0;
    pendingSetextTitle = null;
  };

  for (const line of content.replace(FRONTMATTER_PATTERN, "").split("\n")) {
    const trimmedLine = line.trim();
    const fenceMatch = FENCE_PATTERN.exec(trimmedLine);
    if (fenceMatch) {
      flushPendingText();
      const fenceMarker = fenceMatch[1] ?? "";
      const fenceCharacter: "`" | "~" = fenceMarker.startsWith("`") ? "`" : "~";
      const fenceRemainder = trimmedLine.slice(fenceMarker.length);
      const closesActiveFence =
        activeFenceCharacter === fenceCharacter &&
        fenceMarker.length >= activeFenceLength &&
        fenceRemainder.trim().length === 0;
      tokens.push({ kind: "code", value: line });
      if (closesActiveFence) {
        activeFenceCharacter = null;
        activeFenceLength = 0;
        continue;
      }
      if (activeFenceCharacter === null) {
        activeFenceCharacter = fenceCharacter;
        activeFenceLength = fenceMarker.length;
      }
      continue;
    }

    if (activeFenceCharacter !== null) {
      tokens.push({ kind: "code", value: line });
      continue;
    }

    const headingMatch = HEADING_PATTERN.exec(trimmedLine);
    if (headingMatch) {
      flushPendingText();
      const levelMarker = headingMatch[1];
      if (levelMarker) {
        tokens.push({
          kind: "heading",
          level: levelMarker.length,
          title: cleanHeadingText(headingMatch[2] ?? ""),
        });
      }
      continue;
    }

    const isSetextH1 = SETEXT_H1_PATTERN.test(line);
    const isSetextH2 = SETEXT_H2_PATTERN.test(line);
    if (pendingSetextTitle !== null && (isSetextH1 || isSetextH2)) {
      tokens.push({
        kind: "heading",
        level: isSetextH1 ? 1 : 2,
        title: cleanHeadingText(pendingSetextTitle),
      });
      pendingTextLines.length = 0;
      pendingSetextTitle = null;
      continue;
    }

    if (isSetextH1 || isSetextH2) {
      flushPendingText();
      continue;
    }

    if (isSetextHeadingText(line)) {
      pendingTextLines.push(line);
      pendingSetextTitle = pendingSetextTitle
        ? `${pendingSetextTitle} ${trimmedLine}`
        : trimmedLine;
      continue;
    }

    flushPendingText();
    tokens.push({ kind: "text", value: line });
  }

  flushPendingText();
  return tokens;
}

export function slugifyDocsHeading(input: string): string {
  return normalizeHeadingText(input)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export type DocsHeadingSlugger = {
  slug: (input: string) => string;
};

/**
 * Page-scoped github-slugger-style counter. `extractDocsTableOfContents` and
 * rendered heading components must share one instance per page so duplicate
 * titles get the same `#slug-N` ids.
 *
 * Emitted ids are reserved globally on the page: `Foo`, `Foo`, `Foo-1`
 * becomes `foo`, `foo-1`, `foo-1-1` rather than colliding on `foo-1`.
 */
export function createDocsHeadingSlugger(): DocsHeadingSlugger {
  const nextSuffix = new Map<string, number>();
  const used = new Set<string>();
  return {
    slug(input: string): string {
      const base = slugifyDocsHeading(input);
      let suffix = nextSuffix.get(base) ?? 0;
      let id = suffix === 0 ? base : `${base}-${suffix}`;
      while (used.has(id)) {
        suffix += 1;
        id = `${base}-${suffix}`;
      }
      nextSuffix.set(base, suffix + 1);
      used.add(id);
      return id;
    },
  };
}
