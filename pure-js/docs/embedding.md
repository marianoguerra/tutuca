# Embedding pure-js

An embedder gives pure-js two things: a **host**, what programs may name, and an **entry
signature**, what a program's `this` and parameters are. Every example here runs as a test
(`test/docs.test.js`).

## A host and a program

The host's declaration is TypeScript text, plain data; the implementations come apart, by
qualified name. Start from the standard host, which has the parts of `Math`, `Number`, `JSON`,
`Object`, `Array`, `String` whose results depend on their arguments alone.

```js
import assert from "node:assert/strict";
import { compile, draft, read, stdHost } from "pure-js";

const host = stdHost.extend({
	types: { Counter: "{ count: number; step: number; history: number[] }" },
});
const signature = { this: read("Counter"), params: [draft("Counter"), "[number]"], result: "void" };

const { ok, fn, diagnostics } = compile(
	`function (next, [times]) {
		next.count = this.count + this.step * times;
		next.history.push(next.count);
	}`,
	{ host, signature },
);
assert.ok(ok, diagnostics.map((d) => d.message).join("\n"));

const before = Object.freeze({ count: 1, step: 2, history: Object.freeze([]) });
const after = { count: 1, step: 2, history: [] };
fn.call(before, after, [3]);
assert.deepEqual(after, { count: 7, step: 2, history: [7] });
```

## What a check says

`verify` runs the parser, the sieve and the checker; each diagnostic has a code, a message and
a span, and `formatDiagnostic` writes it for people.

```js
import assert from "node:assert/strict";
import { formatDiagnostic, read, draft, stdHost, verify } from "pure-js";

const host = stdHost.extend({ types: { Counter: "{ count: number; label: string }" } });
const source = "function (next) {\n\tthis.count = 1;\n\tnext.label = next.count;\n}";
const { diagnostics } = verify(source, { host, signature: { this: read("Counter"), params: [draft("Counter")] } });
assert.deepEqual(diagnostics.map((d) => d.code), ["immutable-target", "not-assignable"]);
assert.match(formatDiagnostic(diagnostics[0], source, "counter.js"), /counter\.js, line 2, column 2/);
```

## Handles: host objects

A handle is an object of the host's that a program may call and read, but not store, spread or
pass where `unknown` goes. Its declaration lists what it has; its value is whatever the host
passes.

```js
import assert from "node:assert/strict";
import { compile, draft, read, stdHost } from "pure-js";

const host = stdHost.extend({
	types: { Doc: "{ title: string; saved: boolean }" },
	handles: { Log: "{ readonly level: string; write(line: string): void }" },
});
const { fn } = compile(
	'function (next, _args, log) { log.write(`${log.level}: saving ${this.title}`); next.saved = true; }',
	{ host, signature: { this: read("Doc"), params: [draft("Doc"), "[]", "Log"], result: "void" } },
);
const lines = [];
const next = { title: "a", saved: false };
fn.call({ title: "a", saved: false }, next, [], { level: "info", write: (l) => lines.push(l) });
assert.deepEqual(lines, ["info: saving a"]);
assert.equal(next.saved, true);
```

## Modules and nondeterminism

A module's members are signatures (overloads as an array); a member whose result depends on
more than its arguments is declared nondeterministic, and a check with `deterministic: true`
refuses calls to it.

```js
import assert from "node:assert/strict";
import { Host, verify } from "pure-js";

const host = new Host(
	{ modules: { Clock: { now: "() => number", add: "(a: number, b: number) => number" } }, nondeterministic: ["Clock.now"] },
	{ "Clock.now": () => Date.now(), "Clock.add": (a, b) => a + b },
);
const program = "(): number => Clock.add(Clock.now(), 1)";
assert.deepEqual(verify(program, { host }).diagnostics, []);
const strict = verify(program, { host, deterministic: true }).diagnostics;
assert.equal(strict[0].code, "nondeterministic-call");
```

## Whole modules

With the module profile, a program is a module: types, constants, helper functions and
namespaces, whose methods and getters are entries. The embedder says, by path, what signature
each entry has; `compileModule` gives the namespaces as frozen objects whose entries are
ordinary functions (`instantiate` and `runEntry` interpret them instead).

```js
import assert from "node:assert/strict";
import { compileModule, draft, read, stdHost } from "pure-js";

const source = `
export type State = { items: string[]; filter: string };

function matching(items: Readonly<string[]>, filter: string): string[] {
	const out: string[] = [];
	for (const item of items) {
		if (!item.includes(filter)) continue;
		out.push(item);
	}
	return out;
}

export const List = {
	queries: {
		get shown(): number {
			return matching(this.items, this.filter).length;
		},
	},
	on: {
		add: {
			run(next, [item]) {
				next.items.push(item);
			},
		},
	},
};`;
const signatureOf = (path) =>
	path[1] === "on"
		? { this: read("State"), params: [draft("State"), "[string]"], result: "void" }
		: { this: read("State") };
const { ok, namespaces, diagnostics } = compileModule(source, { host: stdHost, signatureOf });
assert.ok(ok, diagnostics.map((d) => d.message).join("\n"));

const state = { items: ["milk", "eggs"], filter: "e" };
const next = structuredClone(state);
namespaces.List.on.add.run.call(state, next, ["bread"]);
assert.deepEqual(next.items, ["milk", "eggs", "bread"]);
assert.equal(Object.getOwnPropertyDescriptor(namespaces.List.queries, "shown").get.call(next), 2);
```

A helper that called itself, directly or through another, would be rejected: the calls between
a module's functions form no cycle, so every run ends.

## The interpreter

Where `new Function` isn't allowed, `run` interprets the checked tree, with the same outcomes
and a step limit.

```js
import assert from "node:assert/strict";
import { run, stdHost, verify } from "pure-js";

const source = "(xs: number[]): number => xs.reduce((sum, x) => sum + x, 0)";
const { program, diagnostics } = verify(source, { host: stdHost });
assert.deepEqual(diagnostics, []);
assert.deepEqual(run(program, { host: stdHost, args: [[1, 2, 3]] }).value, 6);
assert.equal(run(program, { host: stdHost, args: [[1, 2, 3]], maxSteps: 5 }).kind, "undefined");
```

## TypeScript declarations

`host.declarations()` is the host as a `.d.ts`, with a lib of exactly pure-js's built-ins, for
an editor or for `tsc --noLib`. Each record has a mutable and a read-only (`$R`) declaration.

```js
import assert from "node:assert/strict";
import { stdHost } from "pure-js";

const d = stdHost.extend({ types: { P: "{ x: number }" } }).declarations();
assert.match(d, /interface ReadonlyArray<T>/);
assert.match(d, /type P\$R = \{ readonly x: number \};/);
assert.match(d, /declare const Math:/);
```
