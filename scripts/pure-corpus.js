// How many of this repository's handlers are pure-js already: imports the modules that define
// components, takes each component's handlers (on and answers) as the source their functions
// print as, and checks it with tutuca/pure against the component, its fields' and queries'
// types, and the components in reach. Prints the share accepted and why the rest aren't.
//
//   node scripts/pure-corpus.js [--json] [--examples N]

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { pureHandlers } from "../src/pure/index.js";
import { ComponentSpec } from "../src/tutuca.js";

const ROOTS = ["components", "demos", "site/examples", "src"];
const SKIP = /(\/deps\/|\/vendor\/|\.test\.js$|\/pure\/)/;
const files = (dir) =>
	readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) return files(p);
		return p.endsWith(".js") && !SKIP.test(p) ? [p] : [];
	});

// The specs a module exports, as values or one level inside objects and arrays (a book's
// components, a list of them).
const specsIn = (value, out, depth = 0) => {
	if (value instanceof ComponentSpec) out.add(value);
	else if (depth < 2 && value !== null && typeof value === "object") {
		for (const v of Object.values(value)) specsIn(v, out, depth + 1);
	}
};
const specs = new Set();
const failedImports = [];
for (const root of ROOTS) {
	for (const file of files(root)) {
		try {
			specsIn(await import(pathToFileURL(file).href), specs);
		} catch (error) {
			failedImports.push(`${relative(".", file)}: ${String(error.message).split("\n")[0]}`);
		}
	}
}

const byName = new Map();
for (const s of specs) if (!byName.has(s.name)) byName.set(s.name, s);
const universe = [...byName.values()];
const checker = pureHandlers();
const results = [];
for (const spec of specs) {
	const handlers = [
		...Object.entries(spec.on).map(([n, h]) => [`on.${n}`, h]),
		...Object.entries(spec.answers).flatMap(([a, outs]) =>
			Object.entries(outs ?? {}).map(([o, h]) => [`answers.${a}.${o}`, h]),
		),
	];
	for (const [label, h] of handlers) {
		if (h === null || typeof h !== "object" || typeof h.run !== "function") continue;
		const source = h.source ?? String(h.run);
		let diagnostics;
		try {
			diagnostics = checker.check({ ...h, source }, { spec, specs: universe });
		} catch (error) {
			diagnostics = [{ code: "host-error", message: error.message, where: "" }];
		}
		results.push({ component: spec.name, label, source, diagnostics });
	}
}

const total = results.length;
const accepted = results.filter((r) => r.diagnostics.length === 0);
const byCode = new Map();
for (const r of results) {
	if (r.diagnostics.length === 0) continue;
	const code = r.diagnostics[0].code;
	const e = byCode.get(code) ?? { n: 0, examples: [] };
	e.n++;
	e.examples.push(`${r.component}.${r.label}: ${r.diagnostics[0].message.split("\n")[0]}`);
	byCode.set(code, e);
}
const args = process.argv.slice(2);
if (args.includes("--json")) {
	console.log(
		JSON.stringify(
			{
				total,
				accepted: accepted.length,
				byCode: Object.fromEntries([...byCode].map(([k, v]) => [k, v.n])),
			},
			null,
			2,
		),
	);
} else {
	const n = Number(args[args.indexOf("--examples") + 1] ?? 0) || 2;
	console.log(
		`${specs.size} components, ${total} handlers: ${accepted.length} accepted (${((100 * accepted.length) / total).toFixed(1)}%)`,
	);
	// Those that use nothing from their module (no unknown name): what pure-js would take if
	// they repeated the helpers they call.
	const contained = results.filter((r) => !r.diagnostics.some((d) => d.code === "unknown-name"));
	console.log(
		`self-contained (no name from their module): ${contained.length}, of them ${accepted.length} accepted (${((100 * accepted.length) / contained.length).toFixed(1)}%)`,
	);
	if (failedImports.length > 0)
		console.log(
			`(${failedImports.length} modules didn't import, so their components are left out)`,
		);
	console.log("\nwhy the rest aren't, by their first diagnostic:");
	for (const [code, e] of [...byCode].sort((a, b) => b[1].n - a[1].n)) {
		console.log(`${String(e.n).padStart(5)}  ${code}`);
		for (const ex of e.examples.slice(0, n)) console.log(`         ${ex.slice(0, 150)}`);
	}
}
