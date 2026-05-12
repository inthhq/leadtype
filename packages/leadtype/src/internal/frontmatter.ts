import { VFile } from "vfile";
import { matter } from "vfile-matter";
import { stringify as stringifyYaml } from "yaml";

export type ParsedFrontmatter = {
  content: string;
  data: Record<string, unknown>;
};

// Opt into YAML 1.1 timestamp parsing so YAML date/datetime scalars round-trip
// as `Date` instances. Without this, yaml v2 leaves them as strings — see
// https://eemeli.org/yaml/v2/#built-in-custom-tags.
const YAML_OPTIONS = { customTags: ["timestamp" as const] };

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const file = new VFile(raw);
  matter(file, { strip: true, yaml: YAML_OPTIONS });
  const data = (file.data.matter ?? {}) as Record<string, unknown>;
  return { data, content: String(file.value) };
}

export function stringifyFrontmatter(data: Record<string, unknown>): string {
  return stringifyYaml(data, YAML_OPTIONS).trim();
}
