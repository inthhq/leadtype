import { Callout } from "./callout";
import { Card, Cards } from "./card";
import { Mermaid } from "./mermaid";
import { PackageCommandTabs } from "./package-command-tabs";
import { Selector } from "./selector";
import { Step, Steps } from "./steps";
import { Tab, Tabs } from "./tabs";
import { AutoTypeTable, TypeTable } from "./type-table";

/**
 * Default MDX component adapter map. Spread this into your MDXProvider (or
 * framework-specific equivalent) and override individual entries with your
 * own styled components:
 *
 *     import { mdxComponents } from "@inth/docs";
 *     import { MyCallout } from "./my-callout";
 *
 *     const components = { ...mdxComponents, Callout: MyCallout };
 */
export const mdxComponents = {
  AutoTypeTable,
  Callout,
  Card,
  Cards,
  Mermaid,
  PackageCommandTabs,
  Selector,
  Step,
  Steps,
  Tab,
  Tabs,
  TypeTable,
} as const;

export type MdxComponents = typeof mdxComponents;
