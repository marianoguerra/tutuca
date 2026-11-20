# 15. Fields and attribute values

**New words:** `field`, `it`, `apply` and `query` on the host.

A view that reads: `(field name)` is the field `name` of the value being
rendered. The render context gets a second part for that, `it`. For the root
it is the root component; later steps make `it` an item of a list or a child.

    (h 0 "p" ((title (field name))) "Hello, " (field name))

    h("p", { title: field("name") }, "Hello, ", field("name"))

A field is an expression like any other: it works as a child, as an attribute
value and as a key. What it evaluates to is a result, so `normalize` already
knows what to do with it: a string becomes text, null nothing, a list splices.

Now the page depends on the state, and the loop closes for the first time.
The host gets `apply`: step the root with one of its pure messages (step 11),
then render. The view is evaluated again from scratch, lowered again, and
morph changes one text node.

## Session

1. `view.rkt`: `(field fname)` in `e`; `ctx` becomes `(rctx it component)`;
   one clause in `eval`.
2. `lower.rkt`: the same view on two states, through the vdom's `render`.
3. `view.js`: `field`, and `it` in the context.
4. `host.js`: `apply` and `query`.
5. `test/host.test.js`; then `index.html`, and `host.apply("inc", [1])` in the
   browser's console.

**Seam.** `ctx` was `(rctx component)` and is `(rctx it component)`: `root-ctx`,
`with-component` and three tests change.

## Runs at the end

    raco test grow/15-fields/spec/
    node --test "grow/15-fields/test/*.test.js"

and, serving the repository root, `grow/15-fields/index.html`.
