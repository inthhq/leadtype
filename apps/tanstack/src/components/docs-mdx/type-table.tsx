import type { ReactNode } from "react";

export interface TypeTableProperty {
  default?: string;
  deprecated?: boolean;
  description?: ReactNode;
  required?: boolean;
  type: string;
  typeDescription?: ReactNode;
  typeDescriptionLink?: string;
}

const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Only return the URL if it parses and uses a known-safe scheme. Guards
 * against `javascript:` / `data:` being injected via frontmatter that winds
 * up in `typeDescriptionLink`.
 */
function safeUrl(raw: string): string | null {
  // Allow root-relative and explicit path-relative URLs unconditionally.
  if (
    (raw.startsWith("/") && !raw.startsWith("//")) ||
    raw.startsWith("./") ||
    raw.startsWith("../")
  ) {
    return raw;
  }
  try {
    const url = new URL(raw);
    return SAFE_URL_SCHEMES.has(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

function renderTypeWithLink(property: TypeTableProperty): ReactNode {
  if (!property.typeDescriptionLink) {
    return <code>{property.type}</code>;
  }
  const href = safeUrl(property.typeDescriptionLink);
  if (!href) {
    return <code>{property.type}</code>;
  }
  const isExternal = href.startsWith("http://") || href.startsWith("https://");
  return (
    <a
      href={href}
      rel={isExternal ? "noopener noreferrer" : undefined}
      target={isExternal ? "_blank" : undefined}
    >
      <code>{property.type}</code>
    </a>
  );
}

export interface TypeTableProps {
  properties?: Record<string, TypeTableProperty>;
}

export function TypeTable({ properties }: TypeTableProps) {
  const rows = Object.entries(properties ?? {});
  if (rows.length === 0) {
    return null;
  }
  return (
    <table data-leadtype-type-table="">
      <thead>
        <tr>
          <th scope="col">Prop</th>
          <th scope="col">Type</th>
          <th scope="col">Default</th>
          <th scope="col">Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, property]) => (
          <tr
            data-deprecated={property.deprecated || undefined}
            data-required={property.required || undefined}
            key={name}
          >
            <td>
              <code>{name}</code>
              {property.required ? (
                <span data-leadtype-required="" title="Required">
                  *
                </span>
              ) : null}
            </td>
            <td>
              {renderTypeWithLink(property)}
              {property.typeDescription ? (
                <div data-leadtype-type-description="">
                  {property.typeDescription}
                </div>
              ) : null}
            </td>
            <td>
              {property.default === undefined ? (
                "—"
              ) : (
                <code>{property.default}</code>
              )}
            </td>
            <td>{property.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface ExtractedTypeTableProps {
  /** The exported type name in the source file */
  name?: string;
  /** Path to the source file — rendered as a caption; actual type extraction happens at build time via the remark plugin */
  path?: string;
  properties?: Record<string, TypeTableProperty>;
}

export function ExtractedTypeTable({
  path,
  name,
  properties,
}: ExtractedTypeTableProps) {
  const captionParts: string[] = [];
  if (name) {
    captionParts.push(name);
  }
  if (path) {
    captionParts.push(path);
  }
  const hasCaption = captionParts.length > 0;
  const hasRows =
    properties !== undefined && Object.keys(properties).length > 0;

  // Don't render an empty <figure> — nothing to show means nothing to mount.
  if (!(hasCaption || hasRows)) {
    return null;
  }

  return (
    <figure data-leadtype-extracted-type-table="">
      {hasCaption ? (
        <figcaption>
          <code>{captionParts.join(" from ")}</code>
        </figcaption>
      ) : null}
      <TypeTable properties={properties} />
    </figure>
  );
}
