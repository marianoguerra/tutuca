# 3. Key paths

**New words:** `skey`, `upath`, `get-in`, `set-in` (`getIn`, `setIn`).

A key path is the list of property keys from a root value to a value inside
it. `get-in` reads through one; `set-in` writes through one and gives a new
root. They are `prop-get` and `prop-set` from step 1, once per key.

The whole state of an application will be one value, and a key path is how a
component inside it is found and replaced.

## Order of the session

1. `spec/component/paths.rkt`: `define-extended-language Paths Data` with
   `skey` and `upath`.
2. `get-in`, two clauses. `set-in`, two clauses.
3. Tests on one root: read, write then read, write at the root, read below null.
4. `src/component/paths.js`: `getIn`, `setIn`, clause for clause.
5. `test/paths.test.js`: the same root, the same checks, and one more that the
   model gets for free: the old root is unchanged and what was not on the path
   is shared.

## Runs at the end

    raco test grow/03-key-paths/spec/
    node --test "grow/03-key-paths/test/*.test.js"
