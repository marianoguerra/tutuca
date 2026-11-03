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
1. `describe_tables` to learn the columns.
2. `set_option`, or `patch_option(pointer, value)` to change one place;
   `remove_option_key(pointer)` deletes a key.
3. Read the `compile_report`: unknown series types and dataset ids are errors, encoded columns
   a dataset doesn't have are warnings, and anything ECharts throws while drawing is an error.

`set_table(id, rows)` replaces or adds a table (an array of row objects; a CSV table stays
CSV); `remove_table(id)` removes one and `reorder_tables(id, index)` moves one.
