# 4. Expressions

**New words:** `hx`, `env`, `eval-hx`, `truthy?`.

A component supplies small pure functions: a predicate on a field, an
invariant, the body of a handler, the key of a list item. In JavaScript they
are functions. A model cannot hold a JavaScript function, so it holds a term of
a small expression language instead, and `eval-hx` runs it.

This step writes no JS: wherever the model says `hx`, the code takes a function.

## Order of the session

1. `truthy?` in `data.rkt`: what JavaScript's `if` takes as true.
2. `spec/component/expr.rkt`: `define-extended-language Expr Paths` with `x`,
   `env` and `hx`.
3. `eval-hx`: values, names, `get` and `at`, then `=`, `<`, `not`, `and`, `if`,
   `+`, then `push`, `mk-rec`, `mk-arr`.
4. `env-extend`: inner names shadow outer ones.
5. What throws: an unbound name, arithmetic on a string.

## Runs at the end

    raco test grow/04-expressions/spec/
