import path from "node:path";
import createMDX from "@next/mdx";
import { createMdxSourcePlugins } from "leadtype/mdx";

const withMdx = createMDX({
  options: {
    remarkPlugins: [
      ...createMdxSourcePlugins({
        typeTableBasePath: path.resolve(
          process.cwd(),
          "../../examples/shared-docs"
        ),
      }),
    ],
  },
});

export default withMdx({
  pageExtensions: ["ts", "tsx", "mdx"],
});
