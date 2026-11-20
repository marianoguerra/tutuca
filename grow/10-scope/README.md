# 10. Scope and child components

**New words:** `Component` (the type), `Scope`, `register`, `components`.

An instance can hold instances. The type of such a field names the class of
what it holds:

    (Component Counter)        t.component("Counter")

It names the class instead of holding it, so a `Tree` can hold `Tree`s and two
classes can hold each other. With this, the state of an application is one
value: a root instance, with instances inside it, found by the key paths of
step 3.

In the model a component field has no default: someone has to pass the
instance. The code adds one word the model does not have yet, the **scope**:
the place where classes are registered under names. An instance made by a
scope remembers it, and its component fields default to a new instance of the
first class they name, made by the same scope.

## Sessions

**Spec.**

1. `types.rkt`: the `Component` type and its rule in `valid`. No clause in
   `default-of`: a component field is required.
2. `class.rkt`: a `Pair` holding two `Counter`s.

**Code.**

1. `src/component/instance.js`: `classOf` moves here from `class.js`, with
   `scopeOf`, since types need both.
2. `types.js`: the `Component` case in `valid` and in `defaultOf`.
3. `src/component/scope.js`: `Scope`, with `register`, `lookupClass`, `make`,
   `components` and `enter`.
4. `class.js`: `make(args, scope)`.
5. `test/scope.test.js`.

**Seam.** `classOf` and `isComponent` move from `class.js` to `instance.js`;
`class.js` still exports them.

## Runs at the end

    raco test grow/10-scope/spec/
    node --test "grow/10-scope/test/*.test.js"
