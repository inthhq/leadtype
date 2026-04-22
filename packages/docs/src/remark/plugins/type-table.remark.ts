import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSON5 from "json5";
import type { RootContent, Table } from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";
import * as ts from "typescript";
import { u } from "unist-builder";
import {
  createHeading,
  createJsxComponentProcessor,
  createParagraph,
  createTable,
  createTableRow,
  getAttributeValue,
  hasName,
  type MdxNode,
  normalizeWhitespace,
} from "../libs";

type ObjectType = {
  description?: string;
  type: string;
  typeDescription?: string;
  typeDescriptionLink?: string;
  default?: string;
  required?: boolean;
  deprecated?: boolean;
};

let __tsCompilerOptions: ts.CompilerOptions | null = null;
const __tsProgramByRootFile = new Map<
  string,
  {
    program: ts.Program;
    checker: ts.TypeChecker;
    sourceFile: ts.SourceFile;
  }
>();

function getTypeScriptCompilerOptions(): ts.CompilerOptions {
  if (__tsCompilerOptions) {
    return __tsCompilerOptions;
  }

  // Try to resolve tsconfig.json path relative to current working directory
  // This handles both local development and serverless environments
  const tsConfigPath = resolve(process.cwd(), "tsconfig.json");

  // Read and parse tsconfig.json if it exists
  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
  };

  if (existsSync(tsConfigPath)) {
    try {
      const configFile = ts.readConfigFile(tsConfigPath, (path) =>
        readFileSync(path, "utf-8")
      );
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        process.cwd()
      );
      compilerOptions = { ...compilerOptions, ...parsedConfig.options };
    } catch {
      // Fallback to default options if tsconfig parsing fails
    }
  }

  __tsCompilerOptions = compilerOptions;
  return compilerOptions;
}

function getTypeScriptProgramForFile(rootFilePath: string): {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
} | null {
  const cached = __tsProgramByRootFile.get(rootFilePath);
  if (cached) {
    return cached;
  }

  const compilerOptions = getTypeScriptCompilerOptions();
  const host = ts.createCompilerHost(compilerOptions, true);
  const program = ts.createProgram([rootFilePath], compilerOptions, host);
  const sourceFile = program.getSourceFile(rootFilePath);
  if (!sourceFile) {
    return null;
  }
  const checker = program.getTypeChecker();

  const value = { program, checker, sourceFile };
  __tsProgramByRootFile.set(rootFilePath, value);
  return value;
}

type TypeTableOptions = {
  /** When true, include the description column in the output table. */
  includeDescriptions?: boolean;
  /** When true, include the default value column in the output table. */
  includeDefaults?: boolean;
  /** When true, include the required status column in the output table. */
  includeRequired?: boolean;
  /** Base path to resolve relative file paths for ExtractedTypeTable components. */
  basePath?: string;
};

const TABLE_HEADING_DEPTH = 3 as const;

// Precompiled regex for import type resolution
const IMPORT_TYPE_PATTERN = /import\(["']([^"']+)["']\)\.(\w+)/;

// Precompiled regex for JSDoc extraction
const JSDOC_PATTERN = /\/\*\*[\s\S]*?\*\//;

const TRAILING_SLASHES_PATTERN = /\/+$/;

type ParsedProperty = {
  name: string;
  property: ObjectType;
};

/**
 * Parse a JavaScript object literal from an MDX attribute value expression.
 * This handles the properties object that gets passed to the TypeTable component.
 */
function parseTypeObject(
  raw: string | null
): Record<string, ObjectType> | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();

  try {
    // Use JSON5 for robust parsing of JavaScript-like object literals
    const parsed = JSON5.parse(trimmed);

    // Validate the structure
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      // Check if it looks like a valid ObjectType record
      const isValid = Object.values(parsed).every(
        (value) =>
          typeof value === "object" && value !== null && "type" in value
      );

      return isValid ? (parsed as Record<string, ObjectType>) : null;
    }

    return null;
  } catch {
    return null;
  }
}

// Use shared createTableCell and createTableRow functions from remark-libs

function formatPropertyDescription(property: ObjectType): string {
  const parts: string[] = [];

  if (property.description) {
    const desc =
      typeof property.description === "string"
        ? property.description
        : String(property.description);
    parts.push(desc);
  }

  if (property.typeDescription) {
    const typeDesc =
      typeof property.typeDescription === "string"
        ? property.typeDescription
        : String(property.typeDescription);
    parts.push(`(${typeDesc})`);
  }

  return parts.join(" ").trim();
}

function formatPropertyType(property: ObjectType): string {
  let type = property.type;

  if (property.typeDescriptionLink) {
    type = `[${type}](${property.typeDescriptionLink})`;
  }

  if (property.deprecated) {
    type = `~~${type}~~ (deprecated)`;
  }

  return type;
}

function formatPropertyDefault(property: ObjectType): string {
  return property.default === "" ? "-" : (property.default ?? "-");
}

function formatPropertyRequired(property: ObjectType): string {
  return property.required ? "✅ Required" : "Optional";
}

// Use shared createHeading and createParagraph functions from remark-libs

/**
 * Resolve a type name by checking if it's an imported type and extracting just the name
 */
function resolveTypeName(
  type: ts.Type,
  checker: ts.TypeChecker,
  sourceFile?: ts.SourceFile,
  typeBeingExtracted?: string
): string {
  const fullTypeText = checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation
  );

  // Check if this is an imported type (contains 'import("...")')
  const importMatch = fullTypeText.match(IMPORT_TYPE_PATTERN);
  if (importMatch) {
    const importPath = importMatch.at(1);
    const importedTypeName = importMatch.at(2);
    if (importPath === undefined || importedTypeName === undefined) {
      return fullTypeText;
    }

    // If this is the type we're currently extracting, just return the type name
    if (typeBeingExtracted && importedTypeName === typeBeingExtracted) {
      return importedTypeName;
    }

    // If we have a source file and the import path points to the same file,
    // just return the type name without the import
    if (sourceFile && importPath.includes(sourceFile.fileName)) {
      return importedTypeName;
    }

    // For external imports, return just the type name
    return importedTypeName;
  }

  // For local types or built-in types, return the full text
  return fullTypeText;
}

function extractJSDocDescription(
  node: ts.Node,
  sourceFile: ts.SourceFile
): string {
  // Get JSDoc comments from the node
  const jsDocComments = ts.getJSDocCommentsAndTags(node);

  for (const doc of jsDocComments) {
    if (ts.isJSDoc(doc)) {
      const comment = doc.comment;
      if (typeof comment === "string") {
        return comment.trim();
      }
      if (Array.isArray(comment)) {
        return comment
          .map((c) => (typeof c === "string" ? c : c.text))
          .join(" ")
          .trim();
      }
    }
  }

  // Fallback: extract from source text
  const fullText = sourceFile.text.substring(
    node.getFullStart(),
    node.getStart()
  );
  const jsDocMatch = fullText.match(JSDOC_PATTERN);
  if (jsDocMatch) {
    return jsDocMatch[0]
      .replace(/\/\*\*|\*\//g, "")
      .replace(/\*\s*/g, "")
      .trim();
  }

  return "";
}

function extractJSDocDefault(node: ts.Node): string {
  const jsDocTags = ts.getJSDocTags(node);
  for (const tag of jsDocTags) {
    if (tag.tagName && tag.tagName.text === "default") {
      const comment = tag.comment;
      if (typeof comment === "string") {
        return comment.trim();
      }
      if (Array.isArray(comment)) {
        return comment
          .map((c) => (typeof c === "string" ? c : c.text))
          .join(" ")
          .trim();
      }
    }
  }
  return "";
}

function extractPropertyInfo(
  property: ts.PropertySignature | ts.PropertyDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  typeBeingExtracted?: string
): ObjectType {
  const type = checker.getTypeAtLocation(property);
  const typeText = resolveTypeName(
    type,
    checker,
    sourceFile,
    typeBeingExtracted
  );
  const isOptional = !!property.questionToken;

  // Try to get JSDoc comment
  const description = extractJSDocDescription(property, sourceFile);

  // Try to get default value from JSDoc tags
  const defaultValue = extractJSDocDefault(property);

  return {
    type: typeText,
    description: description || undefined,
    required: !isOptional,
    default: defaultValue,
  };
}

function extractInterfaceProperties(
  interfaceDecl: ts.InterfaceDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  typeBeingExtracted?: string
): Record<string, ObjectType> {
  const properties: Record<string, ObjectType> = {};

  for (const member of interfaceDecl.members) {
    if (ts.isPropertySignature(member)) {
      const name =
        member.name && ts.isIdentifier(member.name) ? member.name.text : "";
      if (name) {
        properties[name] = extractPropertyInfo(
          member,
          checker,
          sourceFile,
          typeBeingExtracted
        );
      }
    }
  }

  return properties;
}

function isStaticProperty(member: ts.PropertyDeclaration): boolean {
  const modifiers = ts.getModifiers(member);
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false
  );
}

function extractClassProperties(
  classDecl: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): Record<string, ObjectType> {
  const properties: Record<string, ObjectType> = {};

  for (const member of classDecl.members) {
    if (ts.isPropertyDeclaration(member) && !isStaticProperty(member)) {
      const name =
        member.name && ts.isIdentifier(member.name) ? member.name.text : "";
      if (name) {
        properties[name] = extractPropertyInfo(member, checker, sourceFile);
      }
    }
  }

  return properties;
}

/**
 * Extract JSDoc description from a property symbol
 */
function extractPropertyDescription(
  property: ts.Symbol,
  sourceFile: ts.SourceFile
): string {
  const declarations = property.getDeclarations();
  const firstDeclaration = declarations?.at(0);
  if (firstDeclaration) {
    return extractJSDocDescription(firstDeclaration, sourceFile);
  }
  return "";
}

/**
 * Extract properties from a type alias with type literal
 */
function extractTypeAliasProperties(
  typeAlias: ts.TypeAliasDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  typeName: string
): Record<string, ObjectType> | null {
  const typeNode = typeAlias.type;

  // If it's a type literal (object type), extract properties from it
  if (typeNode && ts.isTypeLiteralNode(typeNode)) {
    const aliasType = checker.getTypeAtLocation(typeAlias);
    const typeAliasText = sourceFile.text.substring(
      typeAlias.getStart(),
      typeAlias.getEnd()
    );

    if (aliasType.isClassOrInterface()) {
      const properties: Record<string, ObjectType> = {};
      const typeProperties = aliasType.getProperties();

      for (const property of typeProperties) {
        const propertyName = property.getName();
        const propertyType = checker.getTypeOfSymbolAtLocation(
          property,
          sourceFile
        );
        const propertyTypeText = resolveTypeName(
          propertyType,
          checker,
          sourceFile,
          typeName
        );

        // Check if property is optional by examining the source text
        const isOptional =
          typeAliasText.includes(`${propertyName}?:`) ||
          typeAliasText.includes(`${propertyName} ?:`);

        const description = extractPropertyDescription(property, sourceFile);

        properties[propertyName] = {
          type: propertyTypeText,
          description: description || undefined,
          required: !isOptional,
        };
      }

      // Only return properties if we found any
      return Object.keys(properties).length > 0 ? properties : null;
    }
  }

  return null;
}

/**
 * Extract type information from a TypeScript file using TypeScript compiler API
 */
function extractPropertiesFromSourceFile(
  sourceFile: ts.SourceFile,
  typeName: string,
  checker: ts.TypeChecker
): Record<string, ObjectType> | null {
  // Visit all nodes to find interfaces, classes, and type aliases
  let interfaceDecl: ts.InterfaceDeclaration | null = null;
  let classDecl: ts.ClassDeclaration | null = null;
  let typeAlias: ts.TypeAliasDeclaration | null = null;

  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
      interfaceDecl = node;
    } else if (
      ts.isClassDeclaration(node) &&
      node.name &&
      node.name.text === typeName
    ) {
      classDecl = node;
    } else if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      typeAlias = node;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Look for interfaces first
  if (interfaceDecl) {
    return extractInterfaceProperties(
      interfaceDecl,
      checker,
      sourceFile,
      typeName
    );
  }

  // Look for classes
  if (classDecl) {
    return extractClassProperties(classDecl, checker, sourceFile);
  }

  // Look for type aliases
  if (typeAlias) {
    // Try to extract properties from type alias
    const aliasProperties = extractTypeAliasProperties(
      typeAlias,
      checker,
      sourceFile,
      typeName
    );
    if (aliasProperties) {
      return aliasProperties;
    }

    // Fallback: return the type alias itself if we couldn't extract properties
    const aliasType = checker.getTypeAtLocation(typeAlias);
    const typeText = checker.typeToString(aliasType);
    return {
      [typeName]: {
        type: typeText,
        description: `Type alias for ${typeName}`,
        required: true,
      },
    };
  }

  return null;
}

export function extractTypeFromFile(
  filePath: string,
  typeName: string,
  basePath?: string
): Record<string, ObjectType> | null {
  try {
    const normalizeExtractedTypeTablePath = (
      rawPath: string,
      rawBasePath?: string
    ): string => {
      if (!rawBasePath) {
        return rawPath;
      }

      // Authors commonly write `path="./packages/..."` even when `basePath` is already
      // pointing at a `.../packages` directory (e.g. `.c15t/packages`). In that case,
      // the naive resolution becomes `.../packages/packages/...` and the file can't be found.
      const basePathNormalized = rawBasePath
        .replaceAll("\\", "/")
        .replace(TRAILING_SLASHES_PATTERN, "");
      if (!basePathNormalized.endsWith("/packages")) {
        return rawPath;
      }

      const pathNormalized = rawPath.replaceAll("\\", "/");
      if (pathNormalized.startsWith("./packages/")) {
        return pathNormalized.slice("./packages/".length);
      }
      if (pathNormalized.startsWith("packages/")) {
        return pathNormalized.slice("packages/".length);
      }

      return rawPath;
    };

    // Resolve the file path using basePath if provided
    const normalizedPath = basePath
      ? normalizeExtractedTypeTablePath(filePath, basePath)
      : filePath;
    const resolvedPath = basePath
      ? resolve(basePath, normalizedPath)
      : filePath;

    if (!existsSync(resolvedPath)) {
      return null;
    }

    const tsProgram = getTypeScriptProgramForFile(resolvedPath);
    if (!tsProgram) {
      return null;
    }

    return extractPropertiesFromSourceFile(
      tsProgram.sourceFile,
      typeName,
      tsProgram.checker
    );
  } catch {
    // Silently return null if file can't be found or parsed
    return null;
  }
}

function createExtractedTypeTable(
  properties: ParsedProperty[],
  options: TypeTableOptions
): Table {
  const {
    includeDescriptions = true,
    includeDefaults = true,
    includeRequired = true,
  } = options;

  const headers = ["Property", "Type"];
  if (includeDescriptions) {
    headers.push("Description");
  }
  if (includeDefaults) {
    headers.push("Default");
  }
  if (includeRequired) {
    headers.push("Required");
  }

  // Generate align array dynamically based on headers
  const align = headers.map((header) =>
    header === "Required" ? "center" : "left"
  );

  const rows = properties.map(({ name, property }) => {
    const rowData = [name, formatPropertyType(property)];

    if (includeDescriptions) {
      rowData.push(formatPropertyDescription(property));
    }

    if (includeDefaults) {
      rowData.push(formatPropertyDefault(property));
    }

    if (includeRequired) {
      rowData.push(formatPropertyRequired(property));
    }

    return rowData;
  });

  return createTable(headers, rows, align);
}

function addOptionalContent(
  content: RootContent[],
  title: string | null,
  description: string | null
): void {
  if (title) {
    content.push(createHeading(TABLE_HEADING_DEPTH, title));
  }
  if (description) {
    content.push(createParagraph(description));
  }
}

function processExtractedTypeTableNode(
  node: MdxNode,
  options: TypeTableOptions
): RootContent[] {
  const title =
    normalizeWhitespace(getAttributeValue(node, "title") ?? "") || null;
  const description =
    normalizeWhitespace(getAttributeValue(node, "description") ?? "") || null;
  const extractedTypeName = getAttributeValue(node, "name") || "UnknownType";
  const extractedTypePath = getAttributeValue(node, "path") || "UnknownPath";

  const content: RootContent[] = [];
  addOptionalContent(content, title, description);

  // Try to extract the actual type information from the TypeScript file
  const overrideBasePath =
    getAttributeValue(node, "basePath") || options.basePath;
  const extractedType = extractTypeFromFile(
    extractedTypePath,
    extractedTypeName,
    overrideBasePath || options.basePath
  );

  if (extractedType && Object.keys(extractedType).length > 0) {
    // Successfully extracted type information - generate full table
    const properties: ParsedProperty[] = Object.entries(extractedType).map(
      ([name, property]) => ({
        name,
        property,
      })
    );

    if (properties.length > 0) {
      const table = createExtractedTypeTable(properties, options);
      content.push(table);
    }
  } else {
    // Fallback to simple info table if extraction failed
    const infoTable = createTable(
      ["Property", "Value"],
      [
        ["Type Name", `\`${extractedTypeName}\``],
        ["Source Path", `\`${extractedTypePath}\``],
      ],
      ["left", "left"]
    );

    content.push(infoTable);

    // Add a note about this being an ExtractedTypeTable
    content.push(
      createParagraph(
        `*ExtractedTypeTable: Could not extract \`${extractedTypeName}\` from \`${extractedTypePath}\`. Verify the path/name and that the file is included by your tsconfig.*`
      )
    );
  }

  return content;
}

function isValidTableNode(
  node: MdxJsxFlowElement | MdxJsxTextElement
): boolean {
  return hasName(node, "TypeTable") || hasName(node, "ExtractedTypeTable");
}

function processTypeTableNode(
  node: MdxNode,
  options: TypeTableOptions
): RootContent[] {
  const {
    includeDescriptions = true,
    includeDefaults = true,
    includeRequired = true,
  } = options;

  // Early validation
  if (!isValidTableNode(node)) {
    return [];
  }

  // Handle ExtractedTypeTable components separately
  if (hasName(node, "ExtractedTypeTable")) {
    return processExtractedTypeTableNode(node, options);
  }

  // Handle regular TypeTable components
  const title =
    normalizeWhitespace(getAttributeValue(node, "title") ?? "") || null;
  const description =
    normalizeWhitespace(getAttributeValue(node, "description") ?? "") || null;
  const propertiesRaw = getAttributeValue(node, "properties");

  const typeObject = parseTypeObject(propertiesRaw);

  if (!typeObject) {
    return [];
  }

  const properties: ParsedProperty[] = Object.entries(typeObject).map(
    ([name, property]) => ({
      name,
      property,
    })
  );

  if (properties.length === 0) {
    return [];
  }

  const headers = ["Property", "Type"];
  if (includeDescriptions) {
    headers.push("Description");
  }
  if (includeDefaults) {
    headers.push("Default");
  }
  if (includeRequired) {
    headers.push("Required");
  }

  // Generate align array dynamically based on headers
  const align = headers.map((header) =>
    header === "Required" ? "center" : "left"
  );

  const rows = properties.map(({ name, property }) => {
    const rowData = [name, formatPropertyType(property)];

    if (includeDescriptions) {
      rowData.push(formatPropertyDescription(property));
    }

    if (includeDefaults) {
      rowData.push(formatPropertyDefault(property));
    }

    if (includeRequired) {
      rowData.push(formatPropertyRequired(property));
    }

    return rowData;
  });

  const tableRows = [createTableRow(headers), ...rows.map(createTableRow)];

  const table: Table = u(
    "table",
    {
      align,
    },
    tableRows
  ) as Table;

  const content: RootContent[] = [];

  if (title) {
    content.push(createHeading(TABLE_HEADING_DEPTH, title));
  }

  if (description) {
    content.push(createParagraph(description));
  }

  content.push(table);

  return content;
}

export const remarkTypeTableToMarkdown = (
  opts: Partial<TypeTableOptions> = {}
) => {
  const defaults: TypeTableOptions = {
    includeDescriptions: true,
    includeDefaults: true,
    includeRequired: true,
    basePath: resolve(process.cwd(), ".c15t"),
  };
  const resolved = { ...defaults, ...opts };

  return createJsxComponentProcessor(
    ["TypeTable", "ExtractedTypeTable"],
    (node) => {
      if (hasName(node, "ExtractedTypeTable")) {
        return processExtractedTypeTableNode(node, resolved);
      }
      return processTypeTableNode(node, resolved);
    }
  );
};
