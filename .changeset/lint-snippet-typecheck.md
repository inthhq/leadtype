---
"leadtype": minor
---

Add opt-in TypeScript snippet typechecking (`snippet:types`) — the flagship
tier of code-snippet linting: with `lint: { snippets: { typecheck: true } }`
in the docs config, module-shaped `ts`/`tsx` snippets are assembled into
virtual modules and typechecked against your project's `tsconfig.json` and
real `node_modules`. When a package API changes, every doc example still
calling the old API fails lint — docs that can't rot.

- Twoslash conventions: `// @filename: name.ts` builds multi-file examples
  (parts can import each other), `// @check` opts a fragment in,
  `// @noErrors` opts anything out, and `// ---cut---` hides setup lines
  from rendered output while they still typecheck. A new default markdown
  transform strips all directives from generated mirrors and converted
  output, so the authoring convention never reaches readers.
- Scope is deliberately practical: only snippets containing `import`/`export`
  are checked by default (the copy-pasteable ones), imports of packages your
  project doesn't install degrade to `any` instead of failing, and JSX
  environment gaps (no React installed) are tolerated — strictness applies
  to everything that resolves, most importantly the documented package
  itself.
- All snippets check in one shared compiler program, so cost stays flat
  regardless of snippet count.
