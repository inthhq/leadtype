import { Accordion, AccordionItem } from "./accordion";
import { Audience } from "./audience";
import { Callout } from "./callout";
import { Card, Cards } from "./card";
import { CommandTabs } from "./command-tabs";
import { Example } from "./example";
import { File, FileTree, Folder } from "./file-tree";
import { Mermaid } from "./mermaid";
import { Prompt } from "./prompt";
import { Selector } from "./selector";
import { Step, Steps } from "./steps";
import { Tab, Tabs } from "./tabs";
import { TopicSwitcher } from "./topic-switcher";
import { ExtractedTypeTable, TypeTable } from "./type-table";

export const mdxComponents = {
  Accordion,
  AccordionItem,
  Audience,
  ExtractedTypeTable,
  Callout,
  Card,
  Cards,
  Example,
  File,
  FileTree,
  Folder,
  Mermaid,
  Prompt,
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
