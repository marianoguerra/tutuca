# 7. Classes and instances

**New words:** `class`, `fields`, `comp`, `comp-class`, `make-instance`
(`component`, `make`, `classOf`).

A class is a name and a schema: its fields and their types. An instance is a
value tagged with its class, made from arguments by field name; each field is
`make-field` from step 5.

    (class Counter (fields (n Number)))        component({ name: "Counter", fields: { n: t.number() } })
    (comp Counter (n 0))                       Counter.make()

An instance is a value like any other. It has no identity: two counters at
zero are equal. Reading and writing its fields is `prop-get` and `prop-set`.

Fields are made in the order they are declared, and the owner of each is the
instance so far. That is what `Index` was waiting for.

## Sessions

**Spec.**

1. `data.rkt`: `cname`, the `comp` value, a `prop-get` and a `prop-set` clause
   for it, `comp-class`.
2. `expr.rkt`: `def-name`, `def-section`, `lookup-named`, to read definitions
   whose sections come in any order.
3. `spec/component/class.rkt`: `class-def` with a `fields` section,
   `class-fields`, `make-instance`.

**Code.** `src/component/class.js`

1. `ClassDef` and `component()`.
2. `make`: one `makeField` per field, then freeze.
3. `classOf`: the class is on the prototype, so copying an instance keeps it.
4. `test/class.test.js`.

## Runs at the end

    raco test grow/07-classes/spec/
    node --test "grow/07-classes/test/*.test.js"
