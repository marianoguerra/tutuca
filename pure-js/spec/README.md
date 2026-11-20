# pure-js specification, version 0.2

pure-js is a subset of JavaScript, and of the TypeScript that erases to it, defined by static
rules. A program is in pure-js when it has the syntax below and its profile admits every form
in it (the **sieve**); it is **well-formed** when it type checks against a host and an entry
signature. A well-formed program can name only what its host provides, changes only what its
signature makes mutable, depends only on its arguments (and on host members marked
nondeterministic, which a check can refuse), and ends.

In every other respect pure-js is JavaScript: every program it accepts is valid JavaScript
(once its annotations are erased) and valid strict TypeScript, and a run that pure-js defines
has the result JavaScript gives. A few operations can't be rejected statically; a run that
reaches one has undefined behaviour and aborts (see [Semantics](semantics.md)).

This follows [PurePy](https://pure-py.github.io/)'s design for Python: a strict subset of the
language, exclusions classified as by design or omitted from this version, and a type system as
its well-formedness, compatible with the mainstream checker (mypy there, `tsc --strict` here).

## Contents

- [Syntax](syntax.md): programs, statements, expressions, annotations.
- [Types and well-formedness](types.md): the types, the host, entry signatures, the checking rules.
- [Semantics](semantics.md): values, evaluation, undefined behaviour, outcomes, limits.
- [Features](features.md): every form and its status, the reserved names, the built-in methods
  (generated from `lib/tables.js`).

## Stages and outcomes

| Stage | Call | Rejects with exit status |
|---|---|---|
| parse | `parse(source)` | 4 not JavaScript; 1 or 2 for forms it recognizes and leaves out |
| sieve | `sieve(program, { profile })` | 1 excluded by design, 2 omitted from this version |
| check | `check(program, { host, signature })` | 3 ill-formed |
| compile | `compile(source, options)` | (the audit: never, for a checked program) |
| run | `run(program, ...)`, `runCompiled(fn, ...)` | 5 undefined behaviour, 6 terminated |

Every diagnostic has a kebab-case code (`purejs::unknown-name`), the stage that found it, a span,
and, for a form pure-js leaves out, its exclusion and the profile that will admit it.

## Conformance

`test/conformance/<outcome>/` holds one program per file, its directory the expected outcome
(accept, reject-syntax, reject-static, undefined, escapes) and its header the signature and the
run; `test/golden/` records, for each, the verdict, the tree without positions, the inferred
return type and the run. An implementation conforms when it gives every golden. The MoonBit
port is held to the same files.
