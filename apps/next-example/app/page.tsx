import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">Next.js App Router dogfood</p>
      <h1>Leadtype framework example</h1>
      <p>
        This app renders shared Leadtype docs, serves generated agent artifacts,
        and searches static JSON through <code>leadtype/search/react</code>.
      </p>
      <Link className="button" href="/docs">
        Open docs
      </Link>
    </main>
  );
}
