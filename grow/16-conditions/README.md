# 16. Conditions and queries

**New words:** `if` (`$if`), `$query`.

A view that chooses: `(if test then else)` evaluates the test and then one
branch. Only one: the other is never evaluated, so it may be an expression
that would throw on this state.

    (h 0 "p" ((class (if (field loud) "loud" "quiet"))) ...)

    h("p", { class: $if(field("loud"), "loud", "quiet") }, ...)

The test is true the way JavaScript's `if` takes it: `truthy?` from step 4.

In the code a view can also ask the component a question with arguments:
`$query("startsWith", "A")` calls the query of step 11 on the value being
rendered. A query with no arguments already reads like a field. Queries are
not in the model yet, so `$query` is not either.

With this the first group of view words is complete: a view can show a value,
read the state, and choose.

## Session

1. `view.rkt`: `(if e e e)` in `e`; two clauses in `eval`.
2. Tests: every falsy value, every truthy one, and the branch not taken.
3. `view.js`: `$if` and `$query`.
4. `test/view.test.js`.

## Runs at the end

    raco test grow/16-conditions/spec/
    node --test "grow/16-conditions/test/*.test.js"
