# 13. Static views

**New words:** `e`, `h`, `frag`, `views`, `component` (the definition and the
wrapper node), `registry`, `ctx`, `eval`, `render-view`, `render-root`
(`evalExpr`, `renderView`, `renderRoot`).

A view is an expression, and rendering is evaluating it. This step has the
expressions that read nothing: values, elements built with `h`, and `frag`
for several roots.

    (h 0 "p" ((class "loud")) "Hello, " (h 1 "b" () "world"))

    h("p", { class: "loud" }, "Hello, ", h("b", {}, "world"))

Each `h` is a **template** and has an id, `tid`. An element in the semantic
tree carries the id of the template it came from. That is what will let two
renders of the same template be told from two elements that happen to have the
same tag.

A class gets views, by name; `main` is the one a render uses. `render-view`
evaluates it and wraps the result in a **component node**: the semantic tree
now says "this is the render of a Root".

The model writes a component with both halves in one form, `(component Root
(fields ...) (views ...))`, and `split-component` gives the class of step 7 and
the views. A **registry** is the list of registered components, where a
value's class and views are found by its class name.

## Sessions

**Spec.** `spec/view/view.rkt`

1. `sem.rkt`: the `component` wrapper node.
2. The `View` language: `view-def`, `component-def`, `e`, `attr`, `ctx`,
   `registration`, `registry`.
3. `split-component`, `register`, `register-components`, and the lookups.
4. `eval-attrs` and `eval`: values, nodes, `h`, `frag`.
5. `render-view` and `render-root`.

**Code.**

1. `class.js`: the `view` and `views` options. A class object holds both
   halves, so the code needs no registry: `classOf(value).views`.
2. `src/view/view.js`: `Expr`, `h`, `frag`, `evalExpr`, `renderView`,
   `renderRoot`.
3. `test/view.test.js`: the model's tests, printing a semantic tree.

## Runs at the end

    raco test grow/13-static-views/spec/
    node --test "grow/13-static-views/test/*.test.js"
