import type {
  DetailsHTMLAttributes,
  HTMLAttributes,
  LiHTMLAttributes,
  ReactNode,
} from "react";

function FolderIcon() {
  return (
    <svg
      aria-hidden="true"
      data-leadtype-file-tree-icon="folder"
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
    >
      <path
        d="M1.75 3.5h4.379a.75.75 0 0 1 .53.22L8.19 5.25h6.06a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-8.25a.75.75 0 0 1 .75-.75Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      data-leadtype-file-tree-icon="file"
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
    >
      <path
        d="M3.75 2h5.5L13 5.75v8.5a.75.75 0 0 1-.75.75h-8.5a.75.75 0 0 1-.75-.75v-11.5A.75.75 0 0 1 3.75 2Z"
        fill="currentColor"
        fillOpacity="0.08"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M9.25 2v3.25a.5.5 0 0 0 .5.5H13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      data-leadtype-file-tree-chevron=""
      fill="none"
      height="10"
      viewBox="0 0 16 16"
      width="10"
    >
      <path
        d="m6 4 4 4-4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  root?: string;
  children?: ReactNode;
};

export function FileTree({ root, children, ...rest }: FileTreeProps) {
  return (
    <div data-leadtype-file-tree="" {...rest}>
      {root ? (
        <div data-leadtype-file-tree-root="">
          <FolderIcon />
          <span data-leadtype-file-tree-name="">{root}/</span>
        </div>
      ) : null}
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
        <summary data-leadtype-file-tree-summary="">
          <ChevronIcon />
          <FolderIcon />
          <span data-leadtype-file-tree-name="">{name}/</span>
        </summary>
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
      <FileIcon />
      <span data-leadtype-file-tree-name="">{name}</span>
    </li>
  );
}
