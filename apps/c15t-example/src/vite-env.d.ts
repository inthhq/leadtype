/// <reference types="vite/client" />

declare module "*.mdx" {
  import type { ComponentType } from "react";

  const Component: ComponentType;
  export default Component;
}

declare module "@fontsource-variable/geist";
declare module "@fontsource-variable/geist-mono";
