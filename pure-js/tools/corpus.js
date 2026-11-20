// How much of a corpus of programs pure-js accepts, and why it rejects the rest: reads a JSON
// array of { id, source, signature? } and checks each against the standard host (or --host, a
// .json declaration or a module exporting a Host), grouping the rejections by their first
// diagnostic. Embedders bring their own corpus; tutuca's scripts/pure-corpus.js builds one
// from its components, with their types.
//
//   node tools/corpus.js corpus.json [--host host.json] [--examples 3] [--json]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { draft, Host, read, stdHost, verify } from "../lib/index.js";

const argv = process.argv.slice(2);
const opt = (name) =>
	argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined;
const file = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (file === undefined) {
	console.error(
		"usage: node tools/corpus.js corpus.json [--host host.json] [--examples N] [--json]",
	);
	process.exit(4);
}
let host = stdHost;
const hostFile = opt("host");
if (hostFile !== undefined) {
	const path = resolve(hostFile);
	host = path.endsWith(".json")
		? stdHost.extend(JSON.parse(readFileSync(path, "utf8")))
		: (await import(pathToFileURL(path).href)).default;
	if (!(host instanceof Host)) throw new Error(`${hostFile} gives no Host`);
}
const entry = (s) => {
	const m = typeof s === "string" ? /^(read|draft)\s+(.+)$/.exec(s) : null;
	return m === null ? s : m[1] === "read" ? read(m[2]) : draft(m[2]);
};
const signatureOf = (s) =>
	s === undefined || s === null
		? null
		: {
				this: s.this === undefined ? undefined : entry(s.this),
				params: (s.params ?? []).map(entry),
				result: s.result === undefined ? undefined : entry(s.result),
			};

const corpus = JSON.parse(readFileSync(file, "utf8"));
const byCode = new Map();
let accepted = 0;
for (const { id, source, signature } of corpus) {
	const { diagnostics } = verify(source, { host, signature: signatureOf(signature) });
	if (diagnostics.length === 0) {
		accepted++;
		continue;
	}
	const d = diagnostics[0];
	const e = byCode.get(d.code) ?? { n: 0, exclusion: d.exclusion, examples: [] };
	e.n++;
	e.examples.push(`${id}: ${d.message.split("\n")[0]}`);
	byCode.set(d.code, e);
}
if (argv.includes("--json")) {
	console.log(
		JSON.stringify(
			{
				total: corpus.length,
				accepted,
				byCode: Object.fromEntries([...byCode].map(([k, v]) => [k, v.n])),
			},
			null,
			2,
		),
	);
} else {
	const n = Number(opt("examples") ?? 2);
	console.log(
		`${corpus.length} programs: ${accepted} accepted (${((100 * accepted) / Math.max(1, corpus.length)).toFixed(1)}%)\n`,
	);
	for (const [code, e] of [...byCode].sort((a, b) => b[1].n - a[1].n)) {
		console.log(`${String(e.n).padStart(5)}  ${code}${e.exclusion ? ` (${e.exclusion})` : ""}`);
		for (const x of e.examples.slice(0, n)) console.log(`         ${x.slice(0, 140)}`);
	}
}
