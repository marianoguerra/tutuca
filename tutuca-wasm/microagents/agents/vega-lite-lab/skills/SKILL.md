---
name: vega-lite-lab
description: Writing and fixing Vega-Lite specs that read the user's tables by name, checked by compiling them.
---

# Vega-Lite lab

The spec is a Vega-Lite v6 spec. Tables are named data: write `"data": {"name": "sales"}` to use
the table `sales`, and the lab puts its rows there as `values`. Layers, concatenations and
facets can each name their own table.

A table is `{ "id", "rows": [row objects] }`, or `{ "id", "csv": "CSV text with a header row",
"delimiter": ";" }` (the delimiter is "," when it's left out).

Workflow:
1. `describeTables` to learn the columns and their types.
2. `setSpec` with a first spec, or `patchSpec(pointer, value)` to change one place;
   `removeSpecKey(pointer)` deletes a key.
3. Read the `compileReport`: `errors` stop the chart, `warnings` usually point at a wrong
   field name, type or aggregate.

The lab checks before compiling: marks must be known, every `data.name` must be a table, and
every encoding `field` should be a column (or a name a transform makes with `as`).

`setTable(id, rows)` replaces or adds a table (an array of row objects; a CSV table stays
CSV); `removeTable(id)` removes one and `reorderTables(id, index)` moves one.
