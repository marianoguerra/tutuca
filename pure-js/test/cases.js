// The conformance suite: test/conformance/<outcome>/<name>.js, one program each, its header
// comments saying how to check and run it:
//
//   // @handler TodoList [string]    this: read TodoList, params: draft TodoList, [string], Ctx
//   // @signature {"params": ["read TodoList"], "result": "number"}   any signature
//   // @expect unknown-name          the code of the first diagnostic (rejected cases)
//   // @run {"this": "@todo", "args": ["@draft-todo", ["milk"], "@ctx"]}   run it (fixtures: host.js)
//
// The directory is the expected outcome: accept (checks, and runs as @run says), reject-syntax
// (the parser or the sieve rejects it), reject-static (the checker does), undefined (checks,
// and its run is undefined), escapes (tries to reach outside; rejected, or its run is harmless).
// evaluate() gives what test/golden/ records of a case, the MoonBit port's contract too.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	compile,
	draft,
	exitCodeOf,
	parse,
	print,
	read,
	run,
	runCompiled,
	verify,
} from "../lib/index.js";
import { fixtures, host } from "./host.js";

const here = dirname(fileURLToPath(import.meta.url));
export const CONFORMANCE = join(here, "conformance");
export const GOLDEN = join(here, "golden");
export const OUTCOMES = ["accept", "reject-syntax", "reject-static", "undefined", "escapes"];

export const directives = (source) => {
	const out = {};
	for (const line of source.split("\n")) {
		const m = /^\s*\/\/\s*@(\w+)\s*(.*)$/.exec(line);
		if (m === null) {
			if (/^\s*(\/\/.*)?$/.test(line)) continue;
			break;
		}
		out[m[1]] = m[2].trim();
	}
	return out;
};

export const loadCases = () =>
	OUTCOMES.flatMap((dir) =>
		readdirSync(join(CONFORMANCE, dir))
			.filter((f) => f.endsWith(".js") || f.endsWith(".ts"))
			.sort()
			.map((file) => {
				const source = readFileSync(join(CONFORMANCE, dir, file), "utf8");
				return {
					dir,
					name: file.replace(/\.[jt]s$/, ""),
					file: join(dir, file),
					source,
					directives: directives(source),
				};
			}),
	);

export const entry = (s) => {
	if (typeof s !== "string") return s;
	const m = /^(read|draft)\s+(.+)$/.exec(s);
	if (m === null) return s;
	return m[1] === "read" ? read(m[2]) : draft(m[2]);
};
export const signatureOf = (d) => {
	if (d.handler !== undefined) {
		const m = /^(\w+)\s+(.+)$/.exec(d.handler);
		return { this: read(m[1]), params: [draft(m[1]), m[2], "Ctx"], result: "void" };
	}
	if (d.signature !== undefined) {
		const s = JSON.parse(d.signature);
		return {
			...s,
			this: s.this === undefined ? undefined : entry(s.this),
			params: (s.params ?? []).map(entry),
			result: s.result === undefined ? undefined : entry(s.result),
		};
	}
	return null;
};

// The tree as data the MoonBit port can compare: no positions, no source.
export const stripTree = (node) =>
	JSON.parse(
		JSON.stringify(node, (k, v) =>
			k === "start" || k === "end" || k === "source" ? undefined : v,
		),
	);

const resolveRun = (spec) => {
	const { values, calls } = fixtures();
	const sub = (v) =>
		typeof v === "string" && v.startsWith("@") ? values[v] : Array.isArray(v) ? v.map(sub) : v;
	return { thisValue: sub(spec.this), args: (spec.args ?? []).map(sub), calls };
};
const outcomeData = (o) =>
	o.kind === "finished"
		? { kind: o.kind, value: o.value ?? null }
		: o.kind === "undefined"
			? { kind: o.kind, why: o.why }
			: { kind: o.kind };

// Everything the suite knows of a case: its verdict, and how its runs went on both backends.
export const evaluate = (c) => {
	const signature = signatureOf(c.directives);
	const deterministic = c.directives.deterministic !== undefined;
	const v = verify(c.source, { host, signature, deterministic });
	const result = {
		exit: exitCodeOf(v.diagnostics),
		stage: v.diagnostics[0]?.stage ?? null,
		codes: v.diagnostics.map((d) => d.code),
		returnType: v.returnType,
		tree: v.program === null ? null : stripTree(v.program),
		// The printer's text, with types: what a port's printer must write.
		printed: v.program === null ? null : print(v.program, { types: true }),
	};
	if (v.diagnostics.length > 0 || c.directives.run === undefined) return { result, runs: null };
	const spec = JSON.parse(c.directives.run);
	const compiled = compile(c.source, { host, signature, deterministic });
	const a = resolveRun(spec);
	const ca = runCompiled(compiled.fn, { this: a.thisValue, args: a.args });
	const b = resolveRun(spec);
	const ib = run(parse(c.source).program, { host, this: b.thisValue, args: b.args });
	result.outcome = outcomeData(ca);
	// The interpreter's steps: deterministic, so a port counts the same.
	result.steps = ib.steps;
	result.after = JSON.parse(JSON.stringify(a.args));
	result.calls = JSON.parse(JSON.stringify(a.calls));
	return {
		result,
		runs: {
			compiled: { outcome: outcomeData(ca), after: result.after, calls: result.calls },
			interpreted: {
				outcome: outcomeData(ib),
				after: JSON.parse(JSON.stringify(b.args)),
				calls: JSON.parse(JSON.stringify(b.calls)),
			},
		},
	};
};
