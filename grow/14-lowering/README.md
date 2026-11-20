# 14. Lowering

**New words:** `lower`, `lower-all`, `lower-props`, `lower-root`, `Host`,
`start`, `render`.

Two things have been waiting for each other since step 2: the semantic tree
says what a view rendered, and the vdom turns vnodes into DOM. `lower` joins
them: one clause per kind of semantic node, each giving the vnodes for it.

    text      -> a text vnode
    comment   -> a comment vnode
    group     -> a group with its children lowered
    el        -> make-el, with its props and children lowered
    component -> its children lowered

The last clause is the interesting one. The DOM has no node for "the render of
a component", so for now the component leaves no trace. Step 17 changes that
clause, and only that clause, when something needs to find the component again.

With `lower` there is enough for a **host**: it holds the root component and a
DOM node, and `render` morphs the node's children to `lower-root` of the root.
The model does not need a host yet: by the vdom's theorem, what is on the page
after any number of renders is `render` of the last `lower-root`.

## Sessions

**Spec.** `spec/bind/lower.rkt`

1. `define-union-language Lower View VDom`: the tutuca side and the vdom meet.
2. `lower`, `lower-all`.
3. `lower-props`, `lower-value`: an element in a prop is a vnode value.
4. `lower-root`, and hello world through the vdom's `render`.

**Code.**

1. `src/bind/lower.js`: the same clauses, over `vnode.js`.
2. `src/system/host.js`: `Host`, `start`, `render`.
3. `src/tutuca.js`: what an application imports.
4. `test/lower.test.js`, and `index.html` in a browser.

## Runs at the end

    raco test grow/14-lowering/spec/
    node --test "grow/14-lowering/test/*.test.js"

and, serving the repository root, `grow/14-lowering/index.html`.
