// glob-lab: what each glob matches, its expectations, the tree, the tools.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "glob-lab";

test("the sample's summary counts each glob's matches and expectations", async () => {
	const s = await session(await agent(ID), "repo");
	// g1 also matches Button.test.jsx, which it expects not to.
	assert.equal(s.get("headline"), "4/12 matched · 2 pass · 1 fail");
	const summary = s.get("summary");
	assert.match(summary, /^3 globs, 12 paths\./);
	assert.match(summary, /g1: src\/\*\*\/\*\.\{js,jsx\} matches 4\/12; expectations 2 pass, 1 fail/);
	assert.match(summary, /g2: \*\*\/\*\.md \[nocase\] matches 2\/12/);
	assert.match(summary, /g3: \* \[dot\] matches 3\/12/);
	assert.deepEqual(s.get("domain").paths.length, 12);
});

test("set_glob fixes the failing expectation and answers with the summary", async () => {
	const s = await session(await agent(ID), "repo");
	const out = await s.text("set_glob", { id: "g1", pattern: "src/**/!(*.test).{js,jsx}" });
	assert.match(out, /g1: src\/\*\*\/!\(\*\.test\)\.\{js,jsx\} matches 3\/12; expectations 3 pass, 0 fail/);
	assert.equal(s.get("headline"), "3/12 matched · 3 pass · 0 fail");
	const before = s.get("globs");
	assert.equal((await s.call("set_glob", { id: "nope", pattern: "*" })).isError, true);
	assert.deepEqual(s.get("globs"), before);
	assert.deepEqual(s.host.issues, []);
});

test("options: dot reaches dotfiles, nocase ignores case", async () => {
	const s = await session(await agent(ID), "repo");
	await s.call("set_glob_options", { id: "g3", dot: false, nocase: false });
	assert.deepEqual((await s.json("matches", { glob: "g3" })).matched, ["README.md", "package.json"]);
	await s.call("set_glob_options", { id: "g2", dot: false, nocase: false });
	assert.deepEqual((await s.json("matches", { glob: "g2" })).matched, ["README.md"]);
	assert.equal(s.get("globs")[1].nocase, false);
	assert.equal((await s.call("set_glob_options", { id: "g2", dot: "yes", nocase: false })).isError, true);
	assert.deepEqual(s.host.issues, []);
});

test("matches lists matched and unmatched paths and each expectation; bad ids say so", async () => {
	const s = await session(await agent(ID), "repo");
	const m = await s.json("matches", { glob: "g1" });
	assert.deepEqual(m.matched, ["src/index.js", "src/components/Button.jsx", "src/components/Button.test.jsx", "src/utils/format.js"]);
	assert.equal(m.unmatched.length, 8);
	assert.deepEqual(
		m.expectations.find((e) => e.path === "src/components/Button.test.jsx"),
		{ path: "src/components/Button.test.jsx", expected: "no-match", matched: true, status: "fail" },
	);
	assert.deepEqual([m.pass, m.fail], [2, 1]);
	assert.equal((await s.call("matches", { glob: "nope" })).isError, true);
});

test("explain gives the regex picomatch makes and its scan", async () => {
	const s = await session(await agent(ID), "repo");
	const e = await s.json("explain", { glob: "g1" });
	assert.equal(e.pattern, "src/**/*.{js,jsx}");
	assert.equal(e.base, "src");
	assert.equal(e.glob, "**/*.{js,jsx}");
	assert.equal(e.isGlob, true);
	assert.equal(e.negated, false);
	assert.ok(new RegExp(e.regex, e.flags).test("src/a/b.jsx"));
	await s.call("add_glob", { pattern: "!docs/**" });
	assert.equal((await s.json("explain", { glob: "g4" })).negated, true);
	await s.call("set_glob", { id: "g4", pattern: "" });
	assert.match(s.get("glob_rows")[3].error, /non-empty string/);
	assert.equal((await s.call("explain", { glob: "g4" })).isError, true);
	assert.match(s.get("summary"), /g4:  \(error: .*\) matches 0\/12/);
});

test("expectations: set, cleared, cycled from the tree; a bad outcome is rejected", async () => {
	const s = await session(await agent(ID), "repo");
	await s.call("set_expectation", { glob: "g2", path: "docs/Guide.MD", outcome: "match" });
	assert.equal(s.get("globs")[1].expect["docs/Guide.MD"], "match");
	assert.equal(s.get("headline"), "4/12 matched · 3 pass · 1 fail");
	await s.call("set_expectation", { glob: "g2", path: "docs/Guide.MD", outcome: "none" });
	assert.equal(s.get("globs")[1].expect["docs/Guide.MD"], undefined);
	assert.equal((await s.call("set_expectation", { glob: "g2", path: "x", outcome: "maybe" })).isError, true);
	assert.equal((await s.call("set_expectation", { glob: "g9", path: "x", outcome: "match" })).isError, true);
	// The tree: README.md, package.json, .env, .github/, workflows/, ci.yml, src/, index.js, …
	const tree = s.get("tree");
	assert.deepEqual(tree[3], { path: ".github/", name: ".github/", style: "padding-left: 0rem", kind: "dir", note: "0/1", mark: "none", title: "" });
	assert.equal(tree[7].path, "src/index.js");
	assert.equal(tree[7].kind, "hit");
	assert.equal(tree[7].mark, "pass");
	assert.equal(tree[6].note, "4/5");
	s.send("cycle_path", 0);
	assert.equal(s.get("globs")[0].expect["README.md"], "match");
	assert.equal(s.get("tree")[0].mark, "fail");
	s.send("cycle_path", 0);
	assert.equal(s.get("globs")[0].expect["README.md"], "no-match");
	s.send("cycle_path", 3);
	assert.equal(s.get("globs")[0].expect[".github/"], undefined);
	s.send("focus", "g2");
	s.send("cycle_path", 0);
	assert.equal(s.get("globs")[1].expect["README.md"], "match");
	assert.equal(s.get("focus_label"), "g2: **/*.md");
	assert.deepEqual(s.host.issues, []);
});

test("globs: added, reordered, removed; paths replaced", async () => {
	const s = await session(await agent(ID), "repo");
	await s.call("add_glob", { pattern: "**/*.json" });
	assert.deepEqual(s.get("globs")[3], { id: "g4", pattern: "**/*.json", dot: false, nocase: false, expect: {} });
	await s.call("reorder_globs", { id: "g4", index: 0 });
	assert.deepEqual(s.get("globs").map((g) => g.id), ["g4", "g1", "g2", "g3"]);
	await s.call("remove_glob", { id: "g1" });
	assert.deepEqual(s.get("globs").map((g) => g.id), ["g4", "g2", "g3"]);
	assert.equal((await s.call("remove_glob", { id: "g1" })).isError, true);
	await s.call("set_paths", { text: "a.json\n  b/c.json  \n\nd.txt" });
	assert.equal(s.get("headline"), "2/3 matched · 0 pass · 0 fail");
	assert.deepEqual(s.get("data").paths, "a.json\n  b/c.json  \n\nd.txt");
	assert.deepEqual(s.get("domain").paths, ["a.json", "b/c.json", "d.txt"]);
	assert.deepEqual(s.host.issues, []);
});

test("the row's ✕ on the last glob keeps it: `when` only reports, the handler guards", async () => {
	const s = await session(await agent(ID), "empty");
	const before = s.get("globs");
	assert.equal(before.length, 1);
	s.send("remove_glob", before[0].id);
	assert.deepEqual(s.get("globs"), before);
	assert.equal(s.get("focus_label"), `${before[0].id}: ${before[0].pattern}`);
	assert.deepEqual(s.host.issues.map((i) => i.type), ["messageInvalid"]);
});

test("the empty sample opens with one glob and no paths", async () => {
	const s = await session(await agent(ID), "empty");
	assert.equal(s.get("headline"), "0/0 matched · 0 pass · 0 fail");
	assert.deepEqual(s.get("tree"), []);
});
