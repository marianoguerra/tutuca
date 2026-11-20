// Properties over generated programs. Well-typed handlers, built from a grammar of the
// conformance host's TodoList: the checker accepts them, the printer round-trips them, the
// compiled function and the interpreter agree on every run. Hostile programs, built from the
// names and properties sandbox escapes use: the checker rejects them, or they run without
// reaching past their arguments.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { compile, parse, print, run, runCompiled, verify } from "../lib/index.js";
import { stripTree } from "./cases.js";
import { fixtures, host } from "./host.js";

const signature = {
	this: { mode: "read", type: "TodoList" },
	params: [{ mode: "draft", type: "TodoList" }, "[]", "Ctx"],
	result: "void",
};
const word = fc.stringMatching(/^[a-z ]{0,8}$/);

const { str, num, bool } = fc.letrec((tie) => ({
	str: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		word.map((w) => JSON.stringify(w)),
		fc.constant("this.text"),
		fc.tuple(tie("num"), tie("str")).map(([n, s]) => `\`\${${n}} and \${${s}}\``),
		fc.tuple(tie("str"), tie("str")).map(([a, b]) => `${a} + ${b}`),
		tie("str").map((s) => `(${s}).trim()`),
		word.map((w) => `this.items.map((it) => it.title).join(${JSON.stringify(w)})`),
		fc.tuple(tie("bool"), tie("str"), tie("str")).map(([b, x, y]) => `(${b} ? ${x} : ${y})`),
		tie("num").map((n) => `String(${n})`),
		fc.constant('(this.selected?.title ?? "none")'),
	),
	num: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		fc.integer({ min: 0, max: 99 }).map(String),
		fc.constant("this.count"),
		fc.tuple(tie("num"), tie("num")).map(([a, b]) => `(${a} + ${b})`),
		fc.tuple(tie("num"), tie("num")).map(([a, b]) => `(${a} * ${b})`),
		tie("num").map((n) => `-(${n})`),
		fc.constant("this.items.length"),
		fc.tuple(tie("num"), tie("num")).map(([a, b]) => `Math.max(${a}, ${b})`),
		tie("str").map((s) => `(${s}).length`),
		fc.constant("this.items.filter((it) => it.done).length"),
		fc.constant('(this.tags["urgent"] ?? 0)'),
	),
	bool: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		fc.constantFrom("true", "false"),
		fc.tuple(tie("num"), tie("num")).map(([a, b]) => `${a} < ${b}`),
		// Calls, not paths: a path compared with a literal narrows, and a later comparison with
		// another literal would be one TypeScript rejects too.
		fc.tuple(tie("str"), tie("str")).map(([a, b]) => `(${a}).trim() === (${b}).trim()`),
		tie("bool").map((b) => `!(${b})`),
		fc.tuple(tie("bool"), tie("bool")).map(([a, b]) => `(${a} && ${b})`),
		fc.tuple(tie("bool"), tie("bool")).map(([a, b]) => `(${a} || ${b})`),
		fc.constant("this.items.some((it) => it.done)"),
		fc.constantFrom("this.items.length === 0", "this.count > 1"),
	),
}));
const { statements } = fc.letrec((tie) => ({
	statement: fc.oneof(
		{ depthSize: "small" },
		str.map((s) => `next.text = ${s};`),
		num.map((n) => `next.count = ${n};`),
		fc.tuple(str, bool).map(([s, b]) => `next.items.push({ title: ${s}, done: ${b} });`),
		fc.constantFrom(
			'next.filter = "done";',
			'next.filter = "all";',
			"next.items.reverse();",
			"next.items.pop();",
		),
		fc
			.tuple(bool, tie("statements"), tie("statements"))
			.map(([b, x, y]) => `if (${b}) {\n${x}\n} else {\n${y}\n}`),
		bool.map((b) => `if (${b}) return;`),
		fc.tuple(str, word).map(([s, w]) => `next.tags[${JSON.stringify(w || "k")}] = (${s}).length;`),
	),
	statements: fc.array(tie("statement"), { minLength: 1, maxLength: 4 }).map((xs) => xs.join("\n")),
}));
const handler = statements.map((body) => `function (next, _args, ctx) {\n${body}\n}`);

const canaries = () => ({
	global: Object.getOwnPropertyNames(globalThis).join(),
	objectProto: Object.getOwnPropertyNames(Object.prototype).join(),
	functionProto: Object.getOwnPropertyNames(Function.prototype).join(),
	polluted: {}.polluted,
});
const runBoth = (source) => {
	const compiled = compile(source, { host, signature });
	assert.ok(compiled.ok, compiled.diagnostics.map((d) => d.message).join("\n"));
	const a = fixtures().values;
	const ca = runCompiled(compiled.fn, {
		this: a["@todo"],
		args: [a["@draft-todo"], [], a["@ctx"]],
	});
	const b = fixtures().values;
	const ib = run(parse(source).program, {
		host,
		this: b["@todo"],
		args: [b["@draft-todo"], [], b["@ctx"]],
	});
	return {
		compiled: { kind: ca.kind, draft: a["@draft-todo"] },
		interpreted: { kind: ib.kind, draft: b["@draft-todo"] },
	};
};

describe("well-typed handlers", () => {
	test("the checker accepts them", () => {
		fc.assert(
			fc.property(handler, (src) => {
				const { diagnostics } = verify(src, { host, signature });
				assert.deepEqual(
					diagnostics.map((d) => `${d.code}: ${d.message}`),
					[],
				);
			}),
			{ numRuns: 300 },
		);
	});
	test("the printer round-trips them", () => {
		fc.assert(
			fc.property(handler, (src) => {
				const p = parse(src).program;
				assert.deepEqual(stripTree(parse(print(p)).program), stripTree(p));
			}),
			{ numRuns: 300 },
		);
	});
	test("the compiled function and the interpreter agree", () => {
		fc.assert(
			fc.property(handler, (src) => {
				const before = canaries();
				const { compiled, interpreted } = runBoth(src);
				assert.deepEqual(interpreted, compiled);
				assert.deepEqual(canaries(), before);
			}),
			{ numRuns: 300 },
		);
	});
});

// Pieces of the usual sandbox escapes.
const roots = fc.constantFrom(
	"this",
	"next",
	"ctx",
	"Math",
	"JSON",
	"Object",
	"String",
	"Number",
	"globalThis",
	"Function",
	"eval",
	"arguments",
	"Reflect",
	"undefined",
	"this.items",
	"this.text",
	"next.tags",
);
const steps = fc.constantFrom(
	".constructor",
	".prototype",
	".__proto__",
	".call",
	".apply",
	".bind",
	".toString",
	".valueOf",
	'["constructor"]',
	'["__proto__"]',
	'["prototype"]',
	"[0]",
	".length",
	".map",
	".x",
	'("return globalThis")',
	"()",
	"(this)",
);
const hostile = fc
	.array(fc.tuple(roots, fc.array(steps, { maxLength: 5 })), { minLength: 1, maxLength: 3 })
	.map(
		(xs) =>
			`function (next, _args, ctx) {\n${xs.map(([r, s]) => `next.f(${r}${s.join("")});`).join("\n")}\n}`,
	);
const hostileAssign = fc
	.tuple(
		roots,
		fc.array(steps, { maxLength: 4 }),
		fc.constantFrom('"x"', "1", "null", "this", "next"),
	)
	.map(([r, s, v]) => `function (next) {\n${r}${s.join("")} = ${v};\n}`);

let compiledHostile = 0;
const tryRun = (compiled) => {
	if (!compiled.ok) return;
	compiledHostile++;
	const a = fixtures().values;
	runCompiled(compiled.fn, { this: a["@todo"], args: [a["@draft-todo"], [], a["@ctx"]] });
};
describe("hostile programs", () => {
	// Without the checker, only the sieve, the audit and the runtime's guards stand between a
	// program and the world: they must be enough.
	test("pass the audit only if they can't reach past their arguments, checked or not", () => {
		compiledHostile = 0;
		fc.assert(
			fc.property(fc.oneof(hostile, hostileAssign), (src) => {
				const before = canaries();
				tryRun(compile(src, { host, signature, unchecked: true }));
				assert.deepEqual(canaries(), before);
			}),
			{ numRuns: 2000 },
		);
		assert.ok(
			compiledHostile > 100,
			`only ${compiledHostile} hostile programs got past the audit: the test shows little`,
		);
	});
	test("are rejected or run without reaching past their arguments", () => {
		fc.assert(
			fc.property(fc.oneof(hostile, hostileAssign), (src) => {
				const before = canaries();
				const compiled = compile(src, { host, signature });
				if (compiled.ok) {
					const a = fixtures().values;
					runCompiled(compiled.fn, { this: a["@todo"], args: [a["@draft-todo"], [], a["@ctx"]] });
				}
				assert.deepEqual(canaries(), before);
			}),
			{ numRuns: 1000 },
		);
	});
});
