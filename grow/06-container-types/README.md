# 6. Container types

**New words:** `Enum`, `Option`, `Array`, `Map`, `Record`, `OneOf`, `Index`,
`owner`.

Types made of types. Each one adds a rule to `valid` and a clause to
`default-of`; nothing written in step 5 changes.

    t.array(t.string())                  (Array String)
    t.record({ x: t.number() })          (Record (x Number))
    t.oneOf(t.number(), t.string())      (OneOf Number String)
    t.index("items")                     (Index items)

`Index` is the first type that reads its `owner`: its values are the keys of
another field of the value that holds it, so "the selected item" can only
point at an item that is there.

The step ends with the first properties checked on random terms: whatever the
type and the argument, `make-field` keeps a valid argument, and what it makes
is valid.

## Sessions

**Spec.** `spec/component/types.rkt`

1. The new `ty` productions.
2. Rules `enum`, `option-null`, `option`, `array`, `map`, `record`, `one-of`.
3. `keys-in`, and the two `index` rules: with an owner and without.
4. `default-of` for each. A record makes each key with `make-field`, so a
   key with no default leaves the record with none.
5. `redex-check`, twice.

**Code.** `src/component/types.js`

1. The builders in `t`.
2. The same cases in `valid` and `defaultOf`.
3. `test/types.test.js`: the model's tests, and the two properties with
   fast-check.

## Runs at the end

    raco test grow/06-container-types/spec/
    node --test "grow/06-container-types/test/*.test.js"
