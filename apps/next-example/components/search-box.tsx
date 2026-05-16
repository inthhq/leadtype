"use client";

import { useLeadtypeSearch } from "leadtype/search/react";

export function SearchBox() {
  const { query, search, results, status } = useLeadtypeSearch("docs");
  return (
    <section className="search">
      <input
        aria-label="Search docs"
        onChange={(event) => search(event.currentTarget.value)}
        placeholder="Search docs"
        value={query}
      />
      <span aria-live="polite" role="status">
        {status}
      </span>
      <ul>
        {results.map((result) => (
          <li key={result.id}>
            <a href={result.urlWithHash}>{result.title}</a>
            <p>{result.excerpt}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
