import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
      <p className="text-sm uppercase tracking-wide opacity-60">
        Fumadocs UI dogfood
      </p>
      <h1 className="font-semibold text-4xl">Leadtype framework example</h1>
      <p className="opacity-80">
        This app renders the Leadtype docs through fumadocs-ui with leadtype as
        the source layer, while generated agent artifacts serve markdown,
        search, and llms.txt.
      </p>
      <Link
        className="inline-flex w-fit rounded-md border px-4 py-2 hover:bg-fd-accent"
        href="/docs"
      >
        Open docs →
      </Link>
    </main>
  );
}
