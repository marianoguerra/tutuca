// The parts on their own: hosts, the runtime's guards, the interpreter's limits, profiles,
// the formatter and the command line.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	CALLBACK_METHODS,
	compile,
	draft,
	formatDiagnostic,
	Host,
	METHODS,
	PureUndefined,
	parse,
	RESERVED_NAMES,
	run,
	runtime,
	sieve,
	stdHost,
	verify,
} from "../lib/index.js";

describe("hosts", () => {
	test("a module's value is frozen and has no prototype", () => {
		const m = stdHost.value("Math");
		assert.equal(Object.getPrototypeOf(m), null);
		assert.ok(Object.isFrozen(m));
		assert.equal(m.max(1, 2), 2);
		const n = stdHost.value("Number");
		assert.equal(n("3"), 3);
		assert.equal(Object.getPrototypeOf(n), null);
		assert.equal(n.isInteger(3), true);
	});
	test("extend adds to a host, and describe is plain JSON", () => {
		const h = stdHost.extend(
			{ modules: { Text: { shout: "(s: string) => string" } } },
			{ "Text.shout": (s) => s.toUpperCase() },
		);
		assert.deepEqual(h.describe().modules.Text, { shout: "(s: string) => string" });
		const c = compile("(s) => Text.shout(s)", {
			host: h,
			signature: { params: ["string"], result: "string" },
		});
		assert.ok(c.ok);
		assert.equal(c.fn("hi"), "HI");
	});
	test("a name the host doesn't implement fails when it is compiled, not checked", () => {
		const h = new Host({ functions: { f: "() => number" } });
		assert.deepEqual(
			verify("() => f()", { host: h, signature: { params: [], result: "number" } }).diagnostics,
			[],
		);
		assert.throws(
			() => compile("() => f()", { host: h, signature: { params: [], result: "number" } }),
			/no implementation of f/,
		);
	});
	test("a host declaration with a bad type says where", () => {
		assert.throws(() => new Host({ types: { T: "{ a: }" } }).declarations(), /T "\{ a: \}"/);
		assert.throws(() => new Host({ functions: { $x: "() => number" } }), /plain name/);
	});
	test("declarations are TypeScript", () => {
		const d = new Host({ types: { P: "{ x: number }" } }).declarations({ lib: false });
		assert.match(d, /type P = \{ x: number \};/);
		assert.match(d, /type P\$R = \{ readonly x: number \};/);
	});
});

describe("the runtime's guards", () => {
	test("get reads elements and own keys, nothing else", () => {
		assert.equal(runtime.get([1, 2], 1), 2);
		assert.equal(runtime.get("ab", 0), "a");
		assert.equal(runtime.get({ a: 1 }, "a"), 1);
		assert.equal(runtime.get({ a: 1 }, "constructor"), undefined);
		assert.equal(runtime.get({}, "__proto__"), undefined);
		assert.throws(() => runtime.get([1], "length"), PureUndefined);
		assert.throws(() => runtime.get({}, 1), PureUndefined);
		assert.throws(() => runtime.get(null, 0), TypeError);
	});
	test("set writes elements up to the end and keys but the reserved names", () => {
		const xs = [1];
		runtime.set(xs, 1, 2);
		assert.deepEqual(xs, [1, 2]);
		assert.throws(() => runtime.set(xs, 5, 0), PureUndefined);
		assert.throws(() => runtime.set(xs, -1, 0), PureUndefined);
		assert.throws(() => runtime.set(xs, "x", 0), PureUndefined);
		for (const name of RESERVED_NAMES)
			assert.throws(() => runtime.set({}, name, 1), PureUndefined, name);
		const d = {};
		runtime.set(d, "k", 1);
		assert.deepEqual(d, { k: 1 });
	});
	test("the standard host leaves no reserved key on what it makes", () => {
		const parse = stdHost.value("JSON").parse;
		assert.deepEqual(parse('{"__proto__": 1, "toString": 2, "a": [{"valueOf": 3, "b": 4}]}'), {
			a: [{ b: 4 }],
		});
		const { fromEntries } = stdHost.value("Object");
		assert.deepEqual(fromEntries([["a", 1]]), { a: 1 });
		for (const name of RESERVED_NAMES)
			assert.throws(() => fromEntries([[name, 1]]), PureUndefined, name);
	});
});

describe("callbacks", () => {
	test("CALLBACK_METHODS are the methods whose first parameter is a function", () => {
		const takesOne = Object.values(METHODS).flatMap((methods) =>
			Object.entries(methods)
				.filter(([, m]) => /^(<[^>]*>)?\(\w+\??: \(/.test(m.sig))
				.map(([name]) => name),
		);
		assert.deepEqual([...new Set(takesOne)].sort(), [...CALLBACK_METHODS].sort());
	});
	test("an arrow anywhere else is a function value, without types too", () => {
		for (const src of [
			"function (xs) { return xs.concat((x) => x); }",
			"function (xs) { return xs.push((x) => x); }",
			"function (xs) { return xs.reduce((a, x) => a, (x) => x); }",
			"function (xs) { return Math.max((x) => x); }",
		])
			assert.deepEqual(
				sieve(parse(src).program).diagnostics.map((d) => d.code),
				["arrow-not-callback"],
				src,
			);
	});
	test("the audit gives no callback to a host module's member named like a list method", () => {
		const host = stdHost.extend({ modules: { Lists: { map: "(x: number) => number" } } });
		const c = compile("function () { return Lists.map((x) => x); }", { host, unchecked: true });
		assert.deepEqual(
			c.diagnostics.map((d) => d.message),
			["a callback is given only to a list method"],
		);
	});
});

describe("the interpreter", () => {
	const host = stdHost;
	const nested =
		"(xs) => xs.map((a) => xs.map((b) => xs.map((c) => a + b + c).length).length).length";
	const sig = { params: ["number[]"], result: "number" };
	test("ends a run past its steps as undefined", () => {
		const { program } = parse(nested);
		assert.deepEqual(verify(program, { host, signature: sig }).diagnostics, []);
		const xs = Array.from({ length: 30 }, (_, i) => i);
		const o = run(program, { host, args: [xs], maxSteps: 10_000 });
		assert.equal(o.kind, "undefined");
		assert.match(o.why, /more than 10000 steps/);
		assert.equal(run(program, { host, args: [xs] }).kind, "finished");
	});
	test("counts steps the same way every time", () => {
		const { program } = parse(nested);
		const a = run(program, { host, args: [[1, 2, 3]] });
		const b = run(program, { host, args: [[1, 2, 3]] });
		assert.equal(a.steps, b.steps);
		assert.equal(a.value, 3);
	});
	test("a host function that throws ends the run as terminated", () => {
		const { program } = parse("(s) => JSON.parse(s)");
		const o = run(program, { host, args: ["{"] });
		assert.equal(o.kind, "terminated");
	});
});

describe("profiles", () => {
	test("a profile admits its features, and asking for one that isn't says so", () => {
		const { program } = parse("function (xs) { let n = 0; for (const x of xs) { n += x; } }");
		assert.deepEqual(
			sieve(program, { profile: "core" }).diagnostics.map((d) => d.code),
			["let-declaration", "for-of-statement", "let-assignment"],
		);
		assert.deepEqual(
			sieve(program, { profile: ["let", "forOf"] }).diagnostics.map((d) => d.code),
			[],
		);
		assert.deepEqual(sieve(program, { profile: "module" }).diagnostics, []);
		assert.throws(() => sieve(program, { profile: "tryCatch" }), /no profile tryCatch/);
	});
	test("an omitted form names the profile that will admit it", () => {
		const { program } = parse("function (xs) { for (const x of xs) {} }");
		const [d] = sieve(program).diagnostics;
		assert.equal(d.exclusion, "omitted");
		assert.equal(d.profile, "forOf");
		assert.equal(d.exitCode, 2);
	});
});

describe("formatting", () => {
	test("says the line and column, and underlines the span", () => {
		const src = "function (next) {\n\tnext.x = nope;\n}";
		const d = verify(src, { host: stdHost, signature: { params: [draft("{ x: number }")] } })
			.diagnostics[0];
		const text = formatDiagnostic(d, src, "h.js");
		assert.match(text, /^error\[purejs::unknown-name\]: nope is not a parameter/);
		assert.match(text, /h\.js, line 2, column 11/);
		assert.match(text, /\^\^\^\^/);
	});
});

describe("the command line", () => {
	const cli = fileURLToPath(new URL("../cli/main.js", import.meta.url));
	const dir = mkdtempSync(join(tmpdir(), "pure-js-"));
	const exit = (args) => {
		try {
			execFileSync(process.execPath, [cli, ...args], { stdio: "pipe" });
			return 0;
		} catch (e) {
			return e.status;
		}
	};
	test("exits with the outcome's status", () => {
		const ok = join(dir, "ok.js");
		writeFileSync(ok, "(a: number, b: number): number => a + b");
		const bad = join(dir, "bad.js");
		writeFileSync(bad, "function () { while (true) {} }");
		const omitted = join(dir, "omitted.js");
		writeFileSync(omitted, "function (xs: number[]) { for (const x of xs) {} }");
		const ill = join(dir, "ill.js");
		writeFileSync(ill, "(a: number) => a + nope");
		assert.equal(exit(["check", ok]), 0);
		assert.equal(exit(["check", bad]), 1);
		assert.equal(exit(["check", omitted]), 2);
		assert.equal(exit(["check", ill]), 3);
		assert.equal(exit(["run", ok, "--args", "[1, 2]"]), 0);
	});
});
