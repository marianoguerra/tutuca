# 1. Values

**New words:** `value`, `atom`, `null`, `arr`, `rec`, `prop-get`, `prop-set`.

Everything a component holds is a value: a string, a number, a boolean, null,
an array of values, or a record of named values. Reading a property gives a
value; writing one gives a new value and leaves the old one as it was.

JavaScript already has these, so this step writes no JS. It writes the model's
first language, `Data`, and its first two metafunctions.

## Order of the session

1. `define-language Data`: `atom`, `fname`, `value`, `pkey`.
2. `redex-match?` on a few terms: what is a value and what is not.
3. `prop-get`, with `field-get` for records. A missing property reads as null.
4. Reading a property of null: no clause matches. That is how the model says
   "this throws".
5. `prop-set`, with `field-set`. The old value is unchanged.

## Runs at the end

    raco test grow/01-values/spec/data.rkt
