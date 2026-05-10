import type {
  DetailsHTMLAttributes,
  HTMLAttributes,
  LiHTMLAttributes,
  ReactNode,
} from "react";

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  root?: string;
  children?: ReactNode;
};

export function FileTree({ root, children, ...rest }: FileTreeProps) {
  return (
    <div data-leadtype-file-tree="" {...rest}>
      {root ? <div data-leadtype-file-tree-root="">{root}/</div> : null}
      <ul data-leadtype-file-tree-list="">{children}</ul>
    </div>
  );
}

export type FolderProps = DetailsHTMLAttributes<HTMLDetailsElement> & {
  name: string;
  defaultOpen?: boolean;
  children?: ReactNode;
};

export function Folder({
  name,
  defaultOpen = true,
  children,
  ...rest
}: FolderProps) {
  return (
    <li data-leadtype-file-tree-item="">
      <details data-leadtype-file-tree-folder="" open={defaultOpen} {...rest}>
        <summary data-leadtype-file-tree-name="">{name}/</summary>
        <ul data-leadtype-file-tree-list="">{children}</ul>
      </details>
    </li>
  );
}

export type FileProps = LiHTMLAttributes<HTMLLIElement> & {
  name: string;
};

export function File({ name, ...rest }: FileProps) {
  return (
    <li data-leadtype-file-tree-file="" {...rest}>
      <span data-leadtype-file-tree-name="">{name}</span>
    </li>
  );
}
