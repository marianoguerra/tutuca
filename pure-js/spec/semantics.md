# Semantics

## Values

`undefined`, `null`, booleans, numbers (IEEE doubles), strings (UTF-16), lists, records,
dictionaries, callbacks, host functions (by name) and host handles (opaque). There are no
prototypes: a program reaches no property but the ones its types give it, and the reserved
names ([Features](features.md)) are never reachable, whatever a type says.

## Evaluation

As JavaScript's, in strict mode: left to right, `&&`, `||`, `??` and `?.` short-circuit, a
callback runs when the method calling it calls it. Built-in methods are JavaScript's; they read
a list's length when they start, so a callback that pushes to the list it walks ends. `sort` is
pure-js's own stable top-down merge sort (`compare(a, b)` above 0 puts `b` first), so its
comparator runs the same times, in the same order, on every engine and in every port, and a
run's steps count the same everywhere; with a consistent comparator its result is JavaScript's.

Every run ends: there are no loops, and functions aren't values, so nothing recurses; the
built-in methods walk finite lists. An arrow is only ever the callback of a list method (the
first argument of `map`, `filter`, `sort`, ...), a rule the sieve keeps without types, so no
arrow becomes an element, a field or a host function's argument, and nothing calls program code
after the run (a `then`, a `toString` the host would call).

## Modules

Making a module makes its constants in the order they're written, each frozen all the way down
(a getter isn't read); its helpers are there before any constant. A namespace is a frozen
object whose methods and getters are its entries. `for (const x of xs)` walks what `xs` held
when the loop began (as built-in methods do), so a body that adds to it still ends; a string
is walked by code points, as JavaScript does.

The interpreter counts a step for each statement and expression, each iteration of a for-of
and each call of a helper; a helper's call counts toward the callback depth limit too.

## The realm

Both backends run on the JavaScript realm they're in: compiled code calls the realm's
`Array.prototype.map`, and a record's field is read as JavaScript reads it, through the
prototype when the record doesn't have it (an optional field that's absent). pure-js assumes the
realm's intrinsics are the ones JavaScript specifies. Code in the same realm that changes them
(`Object.prototype.opt = ...`, a replaced `Array.prototype.includes`) changes what programs do,
so a host that shares its realm with code it doesn't trust should freeze the intrinsics first
(SES `lockdown()`), or run programs in a realm of their own. No program can change them: it
reaches no prototype. A run's memory is not bounded by the language (a few nested
callbacks can build a large list); the interpreter's step limit bounds it, and a host that runs
untrusted programs at scale should run them where it can stop them.

## Undefined behaviour

Indexing is the operation pure-js can't check statically, so it is guarded at run time. A run
that reaches any of these aborts with `undefined` instead of doing what JavaScript does:

| Operation | |
|---|---|
| `x[k]`, `k` a number, `x` not a list or a string | |
| `x[k]`, `k` a string, `x` not a dictionary (a list, a string) | an own key of a dictionary; a key it doesn't have is `undefined`, which is defined |
| `x[k] = v`, `k` a number not an integer from 0 to the list's length | appending at the length is defined |
| `x[k] = v`, `k` a reserved name (`"__proto__"`, `"toString"`, ...) | a literal can't spell one either, so no value a program makes has one as its own key |
| `Object.fromEntries(entries)`, a key a reserved name | `JSON.parse` drops reserved keys instead: the text may come from outside |
| a comparator given to `sort` that is not consistent | JavaScript leaves the order to the engine; pure-js can't detect it |

## Outcomes

A run is `{ kind: "finished", value }`, `{ kind: "undefined", why }`, or
`{ kind: "terminated", error }` when an error ends it: a host function throws, a value that
isn't there is read (writing through a read-only value that was stored in a mutable place).
The interpreter also stops a run past its limits, `maxSteps` (1,000,000) and callback depth
`maxDepth` (1,000), as `undefined`; steps are counted the same way on every run.

## Compiling

`compile` prints the checked tree without its types, with indexing lowered to the runtime's
guards (`$pure.get`, `$pure.set`), audits it (every name is the program's or the host's, no
reserved property, `call`/`apply`/`bind` only on modules), and compiles it with `new Function`,
the host's modules and functions as its parameters, frozen and without prototypes, so the
function has nothing else in scope. The audit does not rely on the checker: the tests compile
hostile programs without checking them, and none reaches past its arguments. `new Function`
needs a content security policy that allows it; the interpreter runs the same programs where it
doesn't.
