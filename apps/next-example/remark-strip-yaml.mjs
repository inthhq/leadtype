/** Drop parsed frontmatter nodes before MDX compilation. */
export default function stripYamlFrontmatter() {
  return (tree) => {
    if (Array.isArray(tree.children)) {
      tree.children = tree.children.filter((node) => node.type !== "yaml");
    }
    return tree;
  };
}
