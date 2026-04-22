import { Accordion, AccordionItem } from "./accordion";
import { Callout } from "./callout";
import { Card, Cards } from "./card";
import { CommandTabs } from "./command-tabs";
import { Example } from "./example";
import { Mermaid } from "./mermaid";
import { Selector } from "./selector";
import { Step, Steps } from "./steps";
import { Tab, Tabs } from "./tabs";
import { TopicSwitcher } from "./topic-switcher";
import { ExtractedTypeTable, TypeTable } from "./type-table";

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
  Accordion,
  AccordionItem,
  ExtractedTypeTable,
  Callout,
  Card,
  Cards,
  Example,
  Mermaid,
  CommandTabs,
  Selector,
  Step,
  Steps,
  Tab,
  Tabs,
  TopicSwitcher,
  TypeTable,
} as const;

export type MdxComponents = typeof mdxComponents;
