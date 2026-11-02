---
name: vega-lite-lab
description: Writing and fixing Vega-Lite specs that read the user's tables by name, checked by compiling and rendering them off screen.
---

# Vega-Lite lab

The spec is a Vega-Lite v5 spec. Tables are datasets: write `"data": {"name": "sales"}` to use
the table `sales`. Layers, concatenations and facets can each name their own table.

Workflow:
1. `describe_tables` to learn the columns and their types.
2. `set_spec` with a first spec, or `patch_spec(pointer, value)` to change one place;
   `remove_spec_key(pointer)` deletes a key.
3. Read the `compile_report`: `errors` stop the chart, `warnings` usually point at a wrong
   field name, type or aggregate.
4. `render_svg` to run the data flow and catch runtime warnings.

The lab checks before compiling: marks must be known, every `data.name` must be a table, and
every encoding `field` should be a column (or a name a transform makes with `as`).

`set_table(id, rows)` replaces or adds a table (an array of row objects); `remove_table(id)`
removes one.
