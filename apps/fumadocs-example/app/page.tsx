import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
      <h1 className="font-semibold text-4xl">c15t docs</h1>
      <p className="opacity-80">
        Rendered through fumadocs-ui with leadtype as the source layer.
        c15t&apos;s authored MDX (including <code>&lt;include&gt;</code>{" "}
        partials and <code>&lt;ExtractedTypeTable&gt;</code> components) is
        resolved at build time by <code>mdxSourcePlugins</code>.
      </p>
      <Link
        className="inline-flex w-fit rounded-md border px-4 py-2 hover:bg-fd-accent"
        href="/docs/frameworks/next/quickstart"
      >
        Open the Next.js quickstart →
      </Link>
    </main>
  );
}
