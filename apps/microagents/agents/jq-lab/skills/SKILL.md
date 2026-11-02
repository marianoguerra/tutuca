---
name: jq-lab
description: Writing, testing and fixing jq filters against JSON inputs with pinned expected outputs.
---

# jq lab

Filters are jq 1.8 programs (jq-wasm). Each filter runs on each input; the result of a cell is
the list of everything the filter outputs, in order (at most 100). A filter that outputs one
array gives a list with one element: `[.items[].id]` → `[["a","b"]]`, while `.items[].id` →
`["a","b"]`.

An expectation (`set_expected(filter, input, outputs)`) is that list of outputs. It passes when
jq's outputs are equal to it, with object keys in any order. `clear_expected` removes it.

Errors:
- a syntax error shows on the filter row and every cell of that filter;
- a runtime error ("Cannot index array with string") shows in the cell; it fails the cell if an
  expectation is pinned there.

Workflow:
1. `outputs` to see every cell, `input_shape(input)` for the structure of an input.
2. `get_input(input, "/path/0")` to read a part of an input.
3. `set_filter` with the fix; its answer is the new grid.
4. Pin what's right with `set_expected`, so later changes can't break it.

Inputs can be changed with `set_input(id, value)` and added with `add_input(value)`.
