# pure-js

A subset of JavaScript, and of the TypeScript that erases to it, that can be checked from the
tree alone to do nothing but what its host allows, deterministically, and to end. A program
that checks compiles with `new Function` to a function that has nothing in scope but what the
host gave it; where compiling isn't allowed, an interpreter runs the same tree.

It is to JavaScript what [PurePy](https://pure-py.github.io/) is to Python: a strict subset
(every accepted program is JavaScript and means what JavaScript says, and type checks under
`tsc --strict`), a specification ([spec/](spec/README.md)), exclusions classified as by design or
omitted from this version, and a conformance suite with goldens that the MoonBit port is
held to, as `pure-py-mb` is to PurePy.

```js
import { compile, draft, read, stdHost } from "pure-js";

const host = stdHost.extend({ types: { Todo: "{ title: string; done: boolean; tags: string[] }" } });
const { ok, fn, diagnostics } = compile(
	`function (next, [tag]: [string]) {
		next.done = !this.done;
		if (!this.tags.includes(tag)) next.tags.push(tag);
	}`,
	{ host, signature: { this: read("Todo"), params: [draft("Todo"), "[string]"], result: "void" } },
);
```

## What it guarantees

- **Nothing is allowed unless provided.** Every syntax form, name, property, method and host
  member is looked up in a table (`lib/tables.js`) or the host; anything else is rejected.
- **Capability safety.** A program reaches its parameters, its `const`s and the host's members,
  nothing else: no globals, no prototypes, no reserved names (`constructor`, `__proto__`, ...),
  no function values. The compiler audits the tree it compiles without relying on the checker,
  and indexing goes through run-time guards.
- **Mutation where the signature says.** `read(T)` is read-only all the way down, `draft(T)`
  mutable; literals are fresh.
- **Determinism.** The standard host leaves out what depends on more than its arguments
  (`Math.random`, `Date`, locale methods, `Math.sin`); hosts mark their own nondeterministic
  members, and a check can refuse them.
- **Termination.** No loops, no recursion: only the built-in methods walk lists.
- Not memory bounds, and not a realm whose intrinsics other code has changed (freeze them, or
  give programs a realm of their own): see [semantics](spec/semantics.md).

## Stages

`parse` (source to an ESTree tree acorn would make, with TypeScript annotations), `sieve` (only the
forms the profile admits), `check` (types against a host and an entry signature), then `compile`
(a JavaScript function) or `run` (the interpreter). `verify` is the first three. See
[docs/embedding.md](docs/embedding.md).

## Command line

```
pure-js check handler.js --host host.json --signature '{"this": "read Todo", "params": ["draft Todo", "[string]"]}'
pure-js run handler.js --host host.json --signature ... --this '{...}' --args '[{...}, ["x"]]'
pure-js compile | print | parse | sieve ...
```

Exit status: 0 accepted, 1 excluded by design, 2 omitted from this version, 3 ill-formed,
4 not JavaScript, 5 undefined behaviour, 6 terminated.

## Layout

| Path | |
|---|---|
| `lib/` | the library, no dependencies: `index` `lex` `parse` `ast` `sieve` `types` `check` `module` `print` `compile` `interp` `runtime` `host` `std` `declarations` `doc` `tables` `diagnostic` `formatters` |
| `cli/` | the `pure-js` command |
| `spec/` | the language; `features.md` is generated from the tables |
| `test/conformance/`, `test/golden/` | one program per file by expected outcome, and what each gives |
| `test/` | conformance, oracles (acorn trees, printer round trip, `tsc --strict`), properties (fast-check), units, docs |
| `tools/` | `goldens.js`, `spec-tables.js`, `corpus.js` |

`npm test` runs it all. After changing a case or the language on purpose: `node tools/goldens.js`,
and `node tools/spec-tables.js` after changing the tables.

## The MoonBit port

pure-js-mb ports the library to MoonBit, as pure-py-mb ports PurePy. It copies
`test/conformance/` and `test/golden/` verbatim and is held to every golden: verdicts, diagnostic
codes, trees, the printer's text (`printed`) and runs, step for step (`steps`), and for modules
(`test/golden/module/`) the entries' types, the call graph, the helpers' summaries and the typed
tree. Change the language here, regenerate the goldens, then copy them to the port.

The design keeps the port mechanical: the tree is plain data of a closed set of node kinds
(`CHILDREN` in `lib/ast.js`) and a closed type AST; types are a closed set of kinds
(`lib/types.js`); diagnostics, profiles and outcomes are closed enumerations; every language
fact is a row in `lib/tables.js`; stages don't import later stages; the parser is pure-js's own
(acorn and TypeScript are only oracles); goldens are JSON.

## Status

Version 0.2: the core profile (a program is one function), and the module profile: a program
of types, constants, helper functions and namespaces whose methods are entries, with `let`,
destructuring, `for-of` over a snapshot and block-bodied callbacks; the calls between a
module's functions form no cycle, so every run still ends (`verifyModule`, `compileModule`,
`instantiate`, `runEntry`). The let, destructuring and forOf profiles admit those on their
own. `try` is recognized and reported as omitted.
