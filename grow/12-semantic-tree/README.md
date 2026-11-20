# 12. The semantic tree

**New words:** `snode`, `el`, `text`, `comment`, `group`, `result`,
`normalize`, `key-of`.

A view will evaluate to a tree. Not to vnodes: to a tree that says what was
rendered, in the words of the view. For now it has elements, text, comments
and groups; later steps add nodes the DOM has no word for, such as "this is
the render of a Counter" and "these are the items of a loop".

Step 2's vnodes are how the DOM will come to hold that tree. Keeping the two
apart is the main idea of the series: the tree says *what*, and step 14 writes
*how* once.

What an expression of a view evaluates to is looser than a node: a string, a
number, null, a node, a list of any of those. `normalize` turns any such
**result** into a flat list of nodes: lists splice, null drops, nodes stay,
anything else becomes text.

## Session

1. `data.rkt`: `js-string`, JavaScript's `String()`.
2. `spec/view/sem.rkt`: `define-extended-language Sem Class`, the grammar of
   `snode`.
3. `spec/view/normalize.rkt`: `result`, `normalize`, `key-of`, and the
   property that normalizing twice is normalizing once.
4. `src/view/sem.js`: `SNode` and its four constructors.
5. `src/view/normalize.js`: `normalize`, `keyOf`.
6. `test/normalize.test.js`.

## Runs at the end

    raco test grow/12-semantic-tree/spec/
    node --test "grow/12-semantic-tree/test/*.test.js"
