import type { ReactNode } from "react";

export type TypeTableProperty = {
  description?: ReactNode;
  type: string;
  typeDescription?: ReactNode;
  typeDescriptionLink?: string;
  default?: string;
  required?: boolean;
  deprecated?: boolean;
};

export type TypeTableProps = {
  type?: Record<string, TypeTableProperty>;
};

export function TypeTable({ type }: TypeTableProps) {
  const rows = Object.entries(type ?? {});
  if (rows.length === 0) {
    return null;
  }
  return (
    <table data-inth-type-table="">
      <thead>
        <tr>
          <th>Prop</th>
          <th>Type</th>
          <th>Default</th>
          <th>Description</th>
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
                <span data-inth-required="" title="Required">
                  *
                </span>
              ) : null}
            </td>
            <td>
              {property.typeDescriptionLink ? (
                <a href={property.typeDescriptionLink}>
                  <code>{property.type}</code>
                </a>
              ) : (
                <code>{property.type}</code>
              )}
              {property.typeDescription ? (
                <div data-inth-type-description="">
                  {property.typeDescription}
                </div>
              ) : null}
            </td>
            <td>{property.default ? <code>{property.default}</code> : "—"}</td>
            <td>{property.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type AutoTypeTableProps = {
  /** Path to the source file — rendered as a caption; actual type extraction happens at build time via the remark plugin */
  path?: string;
  /** The exported type name in the source file */
  name?: string;
  type?: Record<string, TypeTableProperty>;
};

export function AutoTypeTable({ path, name, type }: AutoTypeTableProps) {
  return (
    <figure data-inth-auto-type-table="">
      {path && name ? (
        <figcaption>
          <code>
            {name} from {path}
          </code>
        </figcaption>
      ) : null}
      <TypeTable type={type} />
    </figure>
  );
}
