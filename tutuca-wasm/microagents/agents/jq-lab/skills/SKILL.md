---
name: jq-lab
description: Writing, testing and fixing jq filters against JSON inputs with pinned expected outputs.
---

# jq lab

Filters are jq 1.8 programs (jq-wasm). Each filter runs on each input; the result of a cell is
the list of everything the filter outputs, in order (at most 100). A filter that outputs one
array gives a list with one element: `[.items[].id]` → `[["a","b"]]`, while `.items[].id` →
`["a","b"]`.

An expectation (`setExpected(filter, input, outputs)`) is that list of outputs. It passes when
jq's outputs are equal to it, with object keys in any order. `clearExpected` removes it.

Errors:
- a syntax error shows on the filter row and every cell of that filter;
- a runtime error ("Cannot index array with string") shows in the cell; it fails the cell if an
  expectation is pinned there.

Workflow:
1. `outputs` to see every cell, `inputShape(input)` for the structure of an input.
2. `getInput(input, "/path/0")` to read a part of an input.
3. `setFilter` with the fix; its answer is the new grid.
4. Pin what's right with `setExpected`, so later changes can't break it.

Inputs can be changed with `setInput(id, value)` and added with `addInput(value)`.
