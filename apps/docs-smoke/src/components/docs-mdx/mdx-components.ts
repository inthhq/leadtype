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
