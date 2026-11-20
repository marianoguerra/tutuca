// The module conformance suite: test/conformance/module/<outcome>/<name>.ts, one module each
// (or <name>/main.ts and the modules it imports, ./x being <name>/x.ts), its header saying
// what its entries are and how to run them:
//
//   // @entries {"Counter.on.*": {"this": "read State", "params": ["draft State", "[number]"]}}
//   // @expect recursive-call        the code of the first diagnostic (rejected cases)
//   // @run {"entry": "Counter.on.add.run", "this": {...}, "args": [{...}, [1]]}
//   // @data {"Counter.defaults": "{ count?: number }"}   the type of a data member, by path
//
// An entries key ending in * matches every path under it. evaluateModule() gives what
// test/golden/module/ records of a case: the verdict, the tree, the printed text, the typed
// tree (each expression's type and mode), the call graph, the helpers' summaries, the entries'
// return types and the run, compiled and interpreted.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	compileModule,
	draft,
	exitCodeOf,
	instantiate,
	parseModule,
	print,
	read,
	runEntry,
	typeToString,
	verifyModule,
} from "../lib/index.js";
import { CONFORMANCE, GOLDEN, OUTCOMES, stripTree } from "./cases.js";
import { moduleHost as host } from "./host.js";

const MODULE_CONFORMANCE = join(CONFORMANCE, "module");
export const MODULE_GOLDEN = join(GOLDEN, "module");

const directives = (source) => {
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

export const loadModuleCases = () =>
	OUTCOMES.flatMap((dir) => {
		const at = join(MODULE_CONFORMANCE, dir);
		if (!existsSync(at)) return [];
		return readdirSync(at)
			.sort()
			.filter((f) => f.endsWith(".ts") || statSync(join(at, f)).isDirectory())
			.map((f) => {
				const isDir = statSync(join(at, f)).isDirectory();
				const main = isDir ? join(at, f, "main.ts") : join(at, f);
				const source = readFileSync(main, "utf8");
				const files = {};
				if (isDir)
					for (const g of readdirSync(join(at, f)))
						if (g !== "main.ts")
							files[`./${g.replace(/\.ts$/, "")}`] = readFileSync(join(at, f, g), "utf8");
				return {
					dir,
					name: f.replace(/\.ts$/, ""),
					file: join("module", dir, f),
					source,
					files,
					directives: directives(source),
				};
			});
	});

const entry = (s) => {
	if (typeof s !== "string") return s;
	const m = /^(read|draft)\s+(.+)$/.exec(s);
	if (m === null) return s;
	return m[1] === "read" ? read(m[2]) : draft(m[2]);
};
const signatureFrom = (s) => ({
	...s,
	this: s.this === undefined ? undefined : entry(s.this),
	params: s.params === undefined ? undefined : s.params.map(entry),
	result: s.result === undefined ? undefined : entry(s.result),
});
// The signature an entry has: the most specific @entries key that matches its path.
export const signaturesOf = (d) => {
	const table = d.entries === undefined ? {} : JSON.parse(d.entries);
	return (path) => {
		const p = path.join(".");
		let best = null;
		for (const key of Object.keys(table)) {
			const hit = key.endsWith("*") ? p.startsWith(key.slice(0, -1)) : p === key;
			if (hit && (best === null || key.length > best.length)) best = key;
		}
		return best === null ? null : signatureFrom(table[best]);
	};
};

const outcomeData = (o) =>
	o.kind === "finished"
		? { kind: o.kind, value: o.value ?? null }
		: o.kind === "undefined"
			? { kind: o.kind, why: o.why }
			: { kind: o.kind };

// The typed tree as data: [start, end, type, mode] for each node it knows, with the draft's
// place last when there is one, in source order.
export const typesOf = (table) =>
	[...table.entries()]
		.map(([n, { t, mode, place }]) => [
			n.start,
			n.end,
			typeToString(t),
			mode,
			...(place === null ? [] : [place]),
		])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const call = (namespaces, path, thisValue, args) => {
	let holder = namespaces[path[0]];
	for (const name of path.slice(1, -1)) holder = holder[name];
	const d = Object.getOwnPropertyDescriptor(holder, path.at(-1));
	return d.get !== undefined ? d.get.call(thisValue) : d.value.apply(thisValue, args);
};

// The types of namespaces' (and consts') data members, from @data: { "C.defaults": "{ a?: number }" }.
const dataTypesOf = (d) => {
	const table = d.data === undefined ? {} : JSON.parse(d.data);
	return (path) => table[path.join(".")] ?? null;
};

export const evaluateModule = (c) => {
	const signatureOf = signaturesOf(c.directives);
	const dataTypeOf = dataTypesOf(c.directives);
	const resolve = (spec) => c.files[spec] ?? null;
	const deterministic = c.directives.deterministic !== undefined;
	const v = verifyModule(c.source, { host, resolve, signatureOf, dataTypeOf, deterministic });
	const tree = v.module === undefined ? parseModule(c.source).module : v.module;
	const result = {
		exit: exitCodeOf(v.diagnostics),
		stage: v.diagnostics[0]?.stage ?? null,
		codes: v.diagnostics.map((d) => d.code),
		tree: tree === null ? null : stripTree(tree),
		printed: tree === null ? null : print(tree, { types: true }),
	};
	if (v.entries !== undefined) {
		result.entries = Object.fromEntries(v.entries.map((e) => [e.path.join("."), e.returnType]));
		result.callGraph = v.callGraph;
		result.summaries = v.summaries;
		result.types = typesOf(v.types);
	}
	if (v.diagnostics.length > 0 || c.directives.run === undefined) return { result, runs: null };
	const spec = JSON.parse(c.directives.run);
	const path = spec.entry.split(".");
	const fresh = () =>
		JSON.parse(JSON.stringify({ this: spec.this ?? null, args: spec.args ?? [] }));
	const a = fresh();
	const compiled = compileModule(c.source, {
		host,
		resolve,
		signatureOf,
		dataTypeOf,
		deterministic,
	});
	let ca;
	try {
		ca = { kind: "finished", value: call(compiled.namespaces, path, a.this, a.args) };
	} catch (error) {
		ca = error?.why !== undefined ? { kind: "undefined", why: error.why } : { kind: "terminated" };
	}
	const b = fresh();
	const inst = instantiate(tree, { host, resolve });
	const ib = runEntry(inst, path, { this: b.this, args: b.args });
	result.outcome = outcomeData(ca);
	result.steps = ib.steps;
	result.after = JSON.parse(JSON.stringify(a.args));
	return {
		result,
		runs: {
			compiled: { outcome: outcomeData(ca), after: result.after },
			interpreted: { outcome: outcomeData(ib), after: JSON.parse(JSON.stringify(b.args)) },
		},
	};
};
