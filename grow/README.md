# Growing tutuca

Tutuca's core and its Redex model, written one concept per step. Every step
defines one new word using only the words of the steps before it, and leaves
something that runs.

Each step is a folder, and starts as a copy of the one before it:

    cp -r 01-values 02-vdom-contract

A step holds `spec/` (the Redex model), `src/` (the reference implementation)
and `test/` (what joins them), plus a `README.md` that says what the step adds
and what runs at the end of it.

Two things are given and never written here: the virtual DOM in
`../src/vdom/index.js` and its model in `../spec/vdom/`.

The reference implementation uses the model's layers and the model's names.
Performance comes after it is complete.

Run a step's checks from the repository root:

    raco test grow/NN-name/spec/
    node --test "grow/NN-name/test/*.test.js"

## Steps

| # | Step | Adds |
|---|---|---|
| 1 | `01-values` | the values components are made of; reading and writing a property |
| 2 | `02-vdom-contract` | vnodes, and the one file that makes them |
| 3 | `03-key-paths` | key paths: reading and writing a value inside a value |
| 4 | `04-expressions` | a small expression language that stands for the functions a component supplies |
| 5 | `05-scalar-types` | types for strings, numbers and booleans; constraints; defaults; making a field |
| 6 | `06-container-types` | enums, options, arrays, maps, records, unions and indexes; the first random properties |
| 7 | `07-classes` | classes with typed fields; instances as values |
| 8 | `08-actions` | message handlers as steps from one instance to the next |
| 9 | `09-contracts` | invariants, argument types, pre and post conditions; listing what a message or a state breaks |
| 10 | `10-scope` | fields that hold instances; the scope that registers classes and makes instances by name |
| 11 | `11-interfaces` | pure messages and queries applied directly; interfaces a class implements |
| 12 | `12-semantic-tree` | the tree a view evaluates to; normalizing results into nodes |
| 13 | `13-static-views` | views as expressions; `h`; evaluating a view to a semantic tree |
| 14 | `14-lowering` | from the semantic tree to vnodes; a host that puts a component on a page |
| 15 | `15-fields` | views that read fields; the page follows the state |
| 16 | `16-conditions` | views that choose a branch; queries with arguments in views |
| 17 | `17-markers` | metadata comments: the DOM records where a component was rendered |
