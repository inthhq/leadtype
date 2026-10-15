---
"leadtype": patch
---

`generate` with `--include`/`--exclude`, or with a collection's `include`/`exclude`, now resolves `<include>` partials that the filters leave out. Before, the filtered temp mirror held only the matched pages, so these includes failed with `ENOENT` and left an `[Error: Could not include file ...]` marker in the page. Relative includes in a staged page now resolve next to the original source file, and the partials are still not output as pages. A missing include still warns, and the warning now names the real source file instead of the temp mirror.
