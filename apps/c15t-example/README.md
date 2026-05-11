# c15t Example

This app renders the c15t docs from a local clone under `.docs-src/c15t` and
generates leadtype artifacts from two mounted sources:

- `docs` at `/docs`
- `changelog` at `/changelog`

Run it with:

```sh
bun run --filter c15t-example dev
```

Set `C15T_REFRESH=1` when you want `scripts/setup-source.ts` to pull the latest
changes in the local clone.
