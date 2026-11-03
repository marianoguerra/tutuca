---
name: json-schema-lab
description: Writing, testing and fixing JSON Schemas (draft 2020-12) against example documents with valid/invalid expectations.
---

# JSON Schema lab

Schemas are validated with Ajv's 2020-12 validator, `allErrors` on, `strict` off, with the
formats of ajv-formats (`email`, `date`, `date-time`, `uri`, `uuid`, `ipv4`, …). A `$schema` that
names another draft (draft-07 and older) fails to compile: drop it or use
`https://json-schema.org/draft/2020-12/schema`.

An example's expectation is `pass` (the document should be valid) or `fail` (it should be
invalid). An example passes when its validity matches its expectation.

Workflow:
1. `validation` to see which examples fail.
2. `errors_for(id)` on a failing example: each error has the `instancePath` of the offending
   value in the example and the message.
3. `patch_schema(pointer, value)` with a small fix, e.g.
   `patch_schema("/properties/nickname", {"type": "string"})`, then `validation` again.
4. Add examples (`add_example`) for edge cases so the fix is pinned down.

Pointers follow RFC 6901: segments start with `/`, and `~` and `/` inside a key are written
`~0` and `~1` (`/properties/a~1b` is the key `a/b`).
