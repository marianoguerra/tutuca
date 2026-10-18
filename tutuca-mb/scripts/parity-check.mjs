// Checks docs/parity against the JS repository's test files themselves: every test the JS suites
// declare (`test(...)`/`it(...)` call sites and the testLintsClean/testGenericProperties helpers)
// has a row in a parity doc, and every row marked ported names MoonBit tests that exist (a
// `test "title"` in some .mbt file) or test files / smoke scripts that exist.
// It also compares the stories: every story id the JS component libraries define
// (components/*/stories.js) must be a story of the port's books (examples/storybook/ids prints
// them), and every port story must be a JS one or be listed, with its reason, under "Port-only
// stories" in docs/parity/README.md.
// Usage: node scripts/parity-check.mjs [path to the JS repo, default ..]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

const here = new URL("..", import.meta.url).pathname;
const jsRepo = process.argv[2] ?? join(here, "..");
const walk = (dir, keep) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (["node_modules", "_build", ".mooncakes", "payload"].includes(name)) return [];
		return statSync(path).isDirectory() ? walk(path, keep) : keep(path) ? [path] : [];
	});

// The JS tests: [file, title pattern source, raw].
const jsTests = [];
for (const file of walk(join(jsRepo, "test"), (p) => p.endsWith(".test.js"))) {
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/^\s*(?:test|it)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/gm)) {
		jsTests.push({ file: relative(jsRepo, file), raw: m[2], template: m[1] === "`" });
	}
	for (const m of text.matchAll(/^\s*(testLintsClean|testGenericProperties)\(([^,)]*)/gm)) {
		jsTests.push({ file: relative(jsRepo, file), raw: `${m[1]}(${m[2].trim()}`, helper: m[1], arg: m[2].trim() });
	}
}

// The parity rows: first cell, status, rest.
const docs = walk(join(here, "docs/parity"), (p) => p.endsWith(".md"));
const rows = [];
for (const doc of docs) {
	for (const line of readFileSync(doc, "utf8").split("\n")) {
		if (!line.startsWith("| ") || /^\|\s*-/.test(line)) continue;
		const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
		if (cells.length < 3) continue;
		rows.push({ doc: basename(doc), title: cells[0], status: cells[1].toLowerCase(), rest: cells.slice(2).join(" | "), line });
	}
}
const norm = (s) => s.replace(/[`*\\]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternOf = (t) => {
	if (t.helper) return null;
	const parts = norm(t.raw).split(/\$\{[^}]*\}/);
	return new RegExp(parts.map((p) => escape(p).replace(/\\\.\\\.\\\./g, ".*")).join(".*"));
};
const covers = (t, row) => {
	const title = norm(row.title);
	if (t.helper) {
		const subject = norm(t.arg).replace(/["']/g, "").replace(/components$/, "");
		const kind = t.helper === "testLintsClean" ? /lints? clean/ : /generic properties/;
		return (title.includes(norm(t.helper)) || kind.test(title)) && title.includes(subject);
	}
	if (patternOf(t).test(title)) return true;
	// A template row may abbreviate its parameters with "…" or list them.
	const fixed = norm(t.raw).split(/\$\{[^}]*\}/).filter((p) => p.trim().length > 3);
	return t.template && fixed.length > 0 && fixed.every((p) => title.includes(p.trim()));
};

// The MoonBit tests that exist.
const mbtFiles = walk(here, (p) => p.endsWith(".mbt"));
const mbtTitles = new Set();
for (const f of mbtFiles) {
	for (const m of readFileSync(f, "utf8").matchAll(/^test "((?:\\.|[^"\\])*)"/gm)) mbtTitles.add(norm(m[1].replace(/\\"/g, '"')));
}
const smokeText = walk(join(here, "scripts"), (p) => p.endsWith(".mjs")).map((f) => readFileSync(f, "utf8")).join("\n");
const fileExists = (name) => {
	const bare = name.replace(/[`()]/g, "").replace(/:\d+$/, "");
	return existsSync(join(here, bare)) || mbtFiles.some((f) => f.endsWith(`/${bare}`)) || existsSync(join(here, "scripts", basename(bare)));
};
const references = (row) => {
	const names = [...row.rest.matchAll(/["“`]([^"”`]{8,})["”`]/g)].map((m) => norm(m[1]));
	const files = [...row.rest.matchAll(/([\w./-]+\.(?:mbt|mjs|js))/g)].map((m) => m[1]);
	return { names, files };
};

// "{a,b} x {c,d}" → every combination, as the docs abbreviate parameterized tests.
const expand = (text) => {
	const opt = text.match(/\[([^\[\]]*)\]/);
	if (opt) return [...expand(text.replace(opt[0], "")), ...expand(text.replace(opt[0], opt[1]))];
	const m = text.match(/\{([^{}]*,[^{}]*)\}/);
	if (!m) return [text];
	return m[1].split(",").flatMap((alt) => expand(text.replace(m[0], alt.trim())));
};
const testSources = mbtFiles.filter((f) => /_(wb)?test\.mbt$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
const hasTest = (name) => {
	const n = norm(name).replace(/ \(×\d+\)$/, "");
	if (n.length < 6) return false;
	return expand(n).every((e) => {
		const stem = e.replace(/(\.\.\.|…).*$/, "").trim();
		return [...mbtTitles].some((t) => t === e || t.startsWith(stem) || t.includes(stem)) || smokeText.toLowerCase().includes(stem);
	});
};
const helperUsed = (id) => /^[a-z_][a-z0-9_]*$/.test(id) && new RegExp(`\\b${id}\\(`).test(testSources);

const uncovered = jsTests.filter((t) => !rows.some((r) => covers(t, r)));
const unresolved = [];
let ported = 0;
for (const row of rows) {
	if (!row.status.startsWith("ported")) continue;
	ported++;
	const quoted = [...row.rest.matchAll(/["“`]([^"”`]{4,})["”`]/g)].map((m) => m[1]);
	const files = [...row.rest.matchAll(/([\w./*-]+\.(?:mbt|mjs))/g)].map((m) => m[1]).filter((f) => !f.includes("*"));
	const sameNames = /same names?\b/i.test(row.rest) && hasTest(row.title);
	const ok =
		hasTest(row.title) ||
		sameNames ||
		quoted.some((q) => hasTest(q) || helperUsed(q.replace(/\(.*$/, ""))) ||
		files.some(fileExists);
	if (!ok) unresolved.push(row);
}

// The stories: JS ids from the libraries' stories modules, the port's from its books.
const jsStoryIds = [];
for (const lib of readdirSync(join(jsRepo, "components"))) {
	const file = join(jsRepo, "components", lib, "stories.js");
	if (!existsSync(file)) continue;
	const mod = await import(file);
	for (const value of Object.values(mod)) {
		for (const b of Array.isArray(value) ? value : [value]) {
			for (const s of b?.stories ?? []) jsStoryIds.push(s.id);
		}
	}
}
const portStoryIds = execFileSync("moon", ["run", "--target", "js", "examples/storybook/ids"], {
	cwd: here,
	encoding: "utf8",
	stdio: ["ignore", "pipe", "inherit"],
})
	.split("\n")
	.filter((l) => l.trim() !== "");
const readme = readFileSync(join(here, "docs/parity/README.md"), "utf8");
const portOnlySection = readme.split(/^#+ Port-only stories\s*$/m)[1]?.split(/^#+ /m)[0] ?? "";
const portOnly = new Map(
	[...portOnlySection.matchAll(/^- `([^`]+)`:\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()]),
);
const portSet = new Set(portStoryIds);
const jsSet = new Set(jsStoryIds);
const missingStories = jsStoryIds.filter((id) => !portSet.has(id));
const extraStories = portStoryIds.filter((id) => !jsSet.has(id) && !portOnly.has(id));
const staleAllowed = [...portOnly.keys()].filter((id) => !portSet.has(id) || jsSet.has(id));

console.log(`${jsTests.length} JS test sites in ${jsRepo}/test; ${rows.length} parity rows; ${ported} ported rows; ${mbtTitles.size} MoonBit tests`);
for (const t of uncovered) console.log(`no parity row: ${t.file}: ${t.raw}`);
for (const r of unresolved) console.log(`ported row names no MoonBit test or file that exists: ${r.doc}: ${r.title}`);
console.log(`${jsStoryIds.length} JS stories; ${portStoryIds.length} port stories, ${portOnly.size} port-only`);
for (const id of missingStories) console.log(`JS story missing in the port: ${id}`);
for (const id of extraStories) console.log(`port story not in JS nor listed as port-only: ${id}`);
for (const id of staleAllowed) console.log(`port-only entry that is not a port-only story: ${id}`);
assert.equal(uncovered.length, 0, "every JS test has a parity row");
assert.equal(missingStories.length, 0, "every JS story is a story of the port");
assert.equal(extraStories.length, 0, "every port story is a JS story or listed as port-only");
assert.equal(staleAllowed.length, 0, "every port-only entry names a port-only story");
assert.equal(unresolved.length, 0, "every ported row names something that exists");
console.log("parity check ok");
