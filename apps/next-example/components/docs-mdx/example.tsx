import type { HTMLAttributes, ReactNode } from "react";

const SOURCE_FILE_KEY_HASH_MODULUS = 2_147_483_647;

export interface ExampleSourceFile {
  code: string;
  filename: string;
  id?: string;
  language?: string;
}

export type ExampleProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  filename?: string;
  language?: string;
  code: string;
  sourceFiles?: ExampleSourceFile[];
  children?: ReactNode;
};

function hashString(input: string): string {
  let hash = 0;

  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    hash = (hash * 31 + codePoint) % SOURCE_FILE_KEY_HASH_MODULUS;
  }

  return hash.toString(36);
}

function sourceFileKey(sourceFile: ExampleSourceFile): string {
  return (
    sourceFile.id ??
    `${sourceFile.filename}:${sourceFile.language ?? "tsx"}:${hashString(sourceFile.code)}`
  );
}

export function Example({
  title,
  description,
  filename,
  language = "tsx",
  code,
  sourceFiles = [],
  children,
  ...rest
}: ExampleProps) {
  return (
    <div data-leadtype-example="" {...rest}>
      {title || description ? (
        <div data-leadtype-example-header="">
          {title ? <h3 data-leadtype-example-title="">{title}</h3> : null}
          {description ? (
            <p data-leadtype-example-description="">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children ? <div data-leadtype-example-preview="">{children}</div> : null}
      <div data-leadtype-example-code="">
        {filename ? <p data-leadtype-example-filename="">{filename}</p> : null}
        <pre data-language={language} data-leadtype-example-code-block="">
          <code>{code}</code>
        </pre>
      </div>
      {sourceFiles.length > 0 ? (
        <div data-leadtype-example-source-files="">
          {sourceFiles.map((sourceFile) => (
            <div
              data-leadtype-example-source-file=""
              key={sourceFileKey(sourceFile)}
            >
              <p data-leadtype-example-filename="">{sourceFile.filename}</p>
              <pre
                data-language={sourceFile.language ?? "tsx"}
                data-leadtype-example-code-block=""
              >
                <code>{sourceFile.code}</code>
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
