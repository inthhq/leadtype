import path from "node:path";
import { fileURLToPath } from "node:url";
import createMDX from "@next/mdx";
import { createMdxSourcePlugins } from "leadtype/mdx";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const withMdx = createMDX({
  options: {
    remarkPlugins: [
      ...createMdxSourcePlugins({
        typeTableBasePath: path.resolve(appDir, "../../examples/shared-docs"),
      }),
    ],
  },
});

export default withMdx({
  pageExtensions: ["ts", "tsx", "mdx"],
});
