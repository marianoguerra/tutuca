---
name: echarts-lab
description: Writing and fixing Apache ECharts options whose series read the user's tables through dataset and encode, checked by drawing them to SVG.
---

# ECharts lab

A table is `{ "id", "rows": [row objects] }`, or `{ "id", "csv": "CSV text with a header row",
"delimiter": ";" }` (the delimiter is "," when it's left out).

The lab's dataset list is every table, in order, as `{ id, source }`, followed by the datasets
the option declares itself (a transform such as
`{ "id": "north", "fromDatasetId": "sales", "transform": { "type": "filter", "config": { "dimension": "region", "=": "North" } } }`).
A series without `datasetId` reads the first table.

Workflow:
1. `describeTables` to learn the columns.
2. `setOption`, or `patchOption(pointer, value)` to change one place;
   `removeOptionKey(pointer)` deletes a key.
3. Read the `compileReport`: unknown series types and dataset ids are errors, encoded columns
   a dataset doesn't have are warnings, and anything ECharts throws while drawing is an error.

`setTable(id, rows)` replaces or adds a table (an array of row objects; a CSV table stays
CSV); `removeTable(id)` removes one and `reorderTables(id, index)` moves one.
