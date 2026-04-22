import type { HTMLAttributes, ReactNode } from "react";

const SOURCE_FILE_KEY_HASH_MODULUS = 2_147_483_647;

export type ExampleSourceFile = {
  id?: string;
  filename: string;
  language?: string;
  code: string;
};

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
    <div data-inth-example="" {...rest}>
      {title || description ? (
        <div data-inth-example-header="">
          {title ? <h3 data-inth-example-title="">{title}</h3> : null}
          {description ? (
            <p data-inth-example-description="">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children ? <div data-inth-example-preview="">{children}</div> : null}
      <div data-inth-example-code="">
        {filename ? <p data-inth-example-filename="">{filename}</p> : null}
        <pre data-inth-example-code-block="" data-language={language}>
          <code>{code}</code>
        </pre>
      </div>
      {sourceFiles.length > 0 ? (
        <div data-inth-example-source-files="">
          {sourceFiles.map((sourceFile) => (
            <div
              data-inth-example-source-file=""
              key={sourceFileKey(sourceFile)}
            >
              <p data-inth-example-filename="">{sourceFile.filename}</p>
              <pre
                data-inth-example-code-block=""
                data-language={sourceFile.language ?? "tsx"}
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
