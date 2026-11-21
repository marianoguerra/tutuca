# Types and well-formedness

Well-formedness is a type system. Every name must be a parameter, a `const` or something the
host provides; every property, method and operator must exist for the type it is used at; only
what the entry signature makes mutable may change. A well-formed program also type checks under
`tsc --strict --noUncheckedIndexedAccess` against the host's declarations (the oracle in
`test/oracle.test.js`), as PurePy's programs do under mypy.

## Types

| Type | Written | Notes |
|---|---|---|
| primitives | `number` `string` `boolean` `null` `undefined` | |
| literal | `"open"` `3` `true` | a literal's own type; widened in mutable places |
| `unknown` | `unknown` | only compared, passed on, or narrowed with `typeof` |
| `void` | `void` | what returns nothing; not a value |
| list | `T[]` | indexing gives `T \| undefined` |
| tuple | `[A, B]` | an argument pattern's type |
| record | `{ a: T; b?: U }` or a host name | closed: no field it doesn't declare |
| dictionary | `{ [key: string]: T }` | indexing gives `T \| undefined` |
| union | `A \| B` | nullable values, enums, tagged records |
| handle | a host name | a host object: its fields and methods only, nominal |
| function | host signatures | only called; never a value |
| module | a host name | only its members |

## Mutability

Containers (lists, tuples, records, dictionaries) are mutable or read-only, all the way down:
an entry `read(T)` is read-only, `draft(T)` mutable. A literal is fresh: mutable at its top,
holding what it was given, so `[...this.items]` can be pushed to while its elements stay
read-only. Assigning a value never needs it to be mutable (a value is a value); what changes is
checked at the place that changes: an assignment's target and a mutating method's receiver
(`push`, `splice`, `sort`, ...) must be mutable. A host function's result is read-only unless
the host declares it fresh.

## The host and the entry signature

A host declares, as TypeScript text:

- `types`: records (and aliases) by name, which refer to each other by name;
- `handles`: nominal objects with read-only fields and methods;
- `modules`: namespaces of functions and values (`Math.max`);
- `functions`: names called as they are (`String`); a name may be both;
- `nondeterministic`: members whose results depend on more than their arguments;
- `fresh`: members whose results the program may change.

Members may be overloaded (an array of signatures) and generic (`<V>(r: { [key: string]: V })
=> [string, V][]`). The entry signature gives `this`, the parameters and the result, each a
type or `read(type)` / `draft(type)`; a plain type is read-only to pure-js (tsc sees it as
written, so it can only agree).

## Rules

- **Names.** A name resolves to a parameter, a `const` in scope or a host name; `undefined` is
  built in. No name may be declared twice in reach: not a parameter, not a host name.
- **Members.** `x.name` needs the type of `x` to have `name`: a record's field, a list's or a
  string's `length`, a handle's field, a module's member. A method is only called. A value that
  may be `null` or `undefined` needs `?.` or a check first.
- **Indexing.** Lists and strings by a number, dictionaries by a string. A record is read by
  name, never by a computed key.
- **Calls.** A host function, a module member, a record's or handle's method, or a built-in
  method ([Features](features.md)), with arguments that fit one overload: arity, types (an
  expected type flows into literals and callbacks), a spread only into a rest parameter.
  Callbacks get their parameters' types from the signature and say its type parameters by what
  they return.
- **Operators.** `+` takes two numbers or two strings; `- * / %` numbers; `< > <= >=` two numbers
  or two strings; `===` and `!==` two types with a value in common. Tests (`if`, `?:`, `!`, the
  left of `&&` and `||`) take a boolean or a value that may be `null` or `undefined`, so no
  number or string is converted behind the program's back. A template takes primitives.
- **Assignment.** To a mutable record's field that isn't read-only, a mutable list's element, a
  mutable dictionary's key, with a value of its type. `+=` and `-=` on numbers (`+=` on strings).
- **Returns.** A program returns what its signature or annotation says, on every path, or
  nothing for `void`; without either, what it returns is inferred.
- **Determinism.** With `deterministic`, a call to a nondeterministic member is an error.

## Flow

Checking follows the program's paths, on paths of names and properties (`this.selected`,
`s.kind`), as TypeScript does:

- a test narrows in its branches, and an `if` that returns narrows what follows it: `=== null`,
  `=== undefined`, `typeof x === "string"`, truthiness, a literal, and a discriminant field
  (`s.kind === "circle"` narrows `s` to the records whose `kind` can be `"circle"`);
- an assignment refines its place to what was assigned;
- a call that may change a value (a mutating method, a host function given a mutable value, a
  method of a mutable record) forgets what was known of what it may change;
- inside a callback, what was known of properties is forgotten, of names kept.

## Modules

**Names.** A module's names are its imports, constants, helpers and namespaces, each declared
once; types live apart from values, as in TypeScript, so `type Counter` and `const Counter`
are two names. A function's names may not shadow the module's.

**Types.** A module's type aliases and interfaces are named types, as a host's are; an
imported type keeps its name, and two modules may not declare a type of the same name.

**Constants** are read-only all the way down; their type is their value's, or their
annotation. They are made in the order they're written: a constant whose value needs one
written after it, directly or through the functions it calls, is ill-formed (`const-order`),
as JavaScript would throw there.

**Helpers** are called by name and never used otherwise (`function-as-value`). Their
parameters are annotated: a container written plainly may be changed by the helper, so a
caller gives a value it may change all the way down (`immutable-argument`); written
`Readonly<T>`, it may not. A helper's result is what it returns, inferred when it isn't
annotated; it is **fresh** (the caller may change it) when every value it returns is made in
it. A helper has no `this`.

**Termination.** The calls between a module's functions are known from the tree: no function
is a value. A cycle of calls, a function calling itself directly or through others, is
excluded by design (`recursive-call`); a cycle through constants is `const-cycle`. Imports
form no cycle either.

**Namespaces.** A namespace is not a value (`namespace-as-value`): code reads its data
members, which are read-only, and neither reads nor calls its entries (`entry-access`). Each
entry is checked against the signature the embedder gives for its path, as a program is
against its entry signature; without one its parameters are annotated, and its `this` is a
this parameter's.

**Destructuring and loops.** A pattern binds what its parts are, of the value's mode:
destructuring a draft gives drafts (aliases of the parts they name), a read value read ones,
the rest of a pattern is fresh. A default replaces `undefined`. A `let` holds its declared type
(its value's, widened) and is known to hold what was last assigned; a loop forgets what its
body may change. `for (const x of xs)` takes a list, a tuple or a string (`not-iterable`
otherwise: a dictionary is walked through `Object.entries`).

**The typed tree.** Checking a module records, for every expression, its type and its mode:
`draft` (part of what the entry gave to be changed), `fresh` (made here), `read`, or `value`
(a primitive); for a draft, its **place**, the path from the parameter it came from
(`next.cards[at].tags`), when it is one path. Backends that keep values persistent (the
MoonBit port's WebAssembly compiler) lower writes through those places.
