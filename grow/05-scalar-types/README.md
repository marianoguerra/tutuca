# 5. Scalar types

**New words:** `ty`, `check`, `valid`, `default-of`, `meets?`, `make-field`
(`t`, `valid`, `defaultOf`, `meets`, `makeField`).

A type says which values a field accepts and what the field holds when nobody
says. This step has the four scalar types, `Any`, `String`, `Number` and
`Boolean`, and two ways to change a type: `Refine` adds constraints, `Default`
names the value to start from.

    t.number().int().min(1)      (Refine Number int (min 1))
    t.string().default("new")    (Default String "new")

`make-field` is the word the next steps use: given a type and maybe an
argument, the value the field gets. A valid argument is kept. Anything else
becomes the default, and a default that breaks the type's own constraints
means the field has none: making it throws.

`owner` is the value that holds the field. No type looks at it yet.

## Sessions

**Spec.** `spec/component/types.rkt`

1. `define-extended-language Types Expr`: `ty`, `check`, `owner`, `arg?`.
2. The judgment `valid`: one rule per scalar, then `refine` and `default`.
3. `check-holds?`: `int`, `min`, `max`, `len`, `pred`. A check of the wrong
   kind does not hold.
4. `default-of`, with `clamp` for bounded numbers. `meets?`. `make-field`.

**Code.** `src/component/types.js`

1. `Type`: a kind and its parts, with `default`, `int`, `min`, `max`, `len`,
   `where`.
2. `valid`, `defaultOf`, `meets`, `makeField`, clause for clause.
3. `t`: the builders.
4. `test/types.test.js`: the model's tests.

## Runs at the end

    raco test grow/05-scalar-types/spec/
    node --test "grow/05-scalar-types/test/*.test.js"
