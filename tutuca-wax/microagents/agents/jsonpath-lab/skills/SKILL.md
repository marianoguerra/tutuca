---
name: jsonpath-lab
description: Writing and fixing JSONPath expressions (jsonpath-plus dialect) against a JSON document, with expected result counts.
---

# JSONPath lab

Paths run with jsonpath-plus, `resultType: "all"`: each result has the value and the JSON
Pointer (RFC 6901) where it sits, e.g. `/store/book/0/title`. A path starts with `$`, the
document's root.

A path may have an expected count (`set_expected_count(id, n)`, `-1` to clear). Its status is
pass when it gives exactly that many results, fail when not, and invalid when the path or the
document has an error.

Workflow:
1. `document_paths` to see which pointers exist and what type each value has.
2. `results(id)` on a path to see what it selects.
3. `set_path` with a fix, then `results` again.
4. Pin down the intent with `set_expected_count`.

Filters are JavaScript-like expressions over `@` (the current item): `$..book[?(@.price < 10)]`,
`$..book[?(@.isbn)]` (has an isbn), `$..book[?(@.category === "fiction")]`.
