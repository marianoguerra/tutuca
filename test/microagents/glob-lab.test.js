import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "glob-lab";

test("the repo sample matches glob-lab, its empty sample decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "repo"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const root = registry.open(agent, registry.sample(agent));
	assert.match(root.summary, /^0 globs, 0 paths/);
});

test("decode then encode gives back the same bytes for every sample", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const { id } of agent.samples) {
		const msg = registry.sample(agent, id);
		const root = registry.open(agent, msg);
		assert.equal(encodeMessage(registry.encode(agent, root, msg)), encodeMessage(msg), id);
	}
});

test("the tree marks what the focused glob matches, and edits fix expectations", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "repo");
	assert.equal(d.state.headline, "4/12 matched · 2 pass · 1 fail");
	const tree = d.state.tree;
	assert.deepEqual(
		tree.slice(0, 6).map((r) => [r.name, r.depth]),
		[
			["README.md", 0],
			["package.json", 0],
			[".env", 0],
			[".github/", 0],
			["workflows/", 1],
			["ci.yml", 2],
		],
	);
	const src = tree.find((r) => r.path === "src/");
	assert.equal(src.note, "4/5");
	d.send(ROOT, "set_glob", ["g1", "src/**/!(*.test).{js,jsx}"]);
	d.drain();
	assert.equal(d.state.headline, "3/12 matched · 3 pass · 0 fail");
	d.send(ROOT, "focus", ["g2"]);
	d.send(ROOT, "set_glob_options", ["g2", false, false]);
	d.drain();
	assert.equal(d.state.matches("g2").matched.length, 1);
	const i = d.state.tree.findIndex((r) => r.path === "docs/Guide.MD");
	d.send(ROOT, "cycle_path", [i]);
	d.drain();
	assert.deepEqual(d.state.globs.items[1].expect, { "docs/Guide.MD": "match" });
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.equal(out.messages[0].data.get("pattern"), "src/**/!(*.test).{js,jsx}");
	assert.equal(out.messages[0].meta, message.messages[0].meta);
	assert.equal(out.messages[1].data.get("nocase"), false);
	assert.equal(out.messages[2], message.messages[2]); // untouched parts stay the same objects
	assert.equal(out.messages[3], message.messages[3]);
});

test("an agent opens empty and grows from there", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "empty");
	d.send(ROOT, "add_glob", ["*.md"]);
	d.send(ROOT, "set_paths", ["a.md\nb/c.md\n"]);
	d.drain();
	d.send(ROOT, "set_expectation", ["g1", "b/c.md", "no-match"]);
	d.drain();
	assert.equal(d.state.headline, "1/2 matched · 1 pass · 0 fail");
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, registry.sample(agent));
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
	assert.equal(
		encodeMessage(out),
		'{"id":"glob-lab","kind":"glob-lab","messages":[{"id":"g1","kind":"glob","data":{"pattern":"*.md"},"meta":{"https://tutuca.dev/d/expect":{"b/c.md":"no-match"}}},{"id":"paths","kind":"paths","data":"a.md\\nb/c.md\\n"}]}',
	);
});

test("tools run through the tool runner", async () => {
	const { call, env, text } = await toolRunner(ID, "repo");
	const r = await call("set_glob", { id: "g1", pattern: "src/**/!(*.test).{js,jsx}" });
	assert.equal(r.isError, false);
	assert.match(
		text(r),
		/g1: src\/\*\*\/!\(\*\.test\)\.\{js,jsx\} matches 3\/12; expectations 3 pass, 0 fail/,
	);
	const bad = await call("set_glob", { id: "g9", pattern: "*" });
	assert.equal(bad.isError, true);
	assert.match(text(bad), /precondition/);
	const m = JSON.parse(text(await call("matches", { glob: "g3" })));
	assert.deepEqual(m.matched, ["README.md", "package.json", ".env"]);
	const ex = JSON.parse(text(await call("explain", { glob: "g1" })));
	assert.equal(ex.base, "src");
	assert.ok(new RegExp(ex.regex).test("src/a/b.jsx"));
	assert.equal((await call("explain", { glob: "g9" })).isError, true);
	await call("set_glob", { id: "g2", pattern: "" });
	assert.equal((await call("matches", { glob: "g2" })).isError, true);
	await call("set_paths", { text: "x.md" });
	assert.deepEqual(env.root().pathList, ["x.md"]);
	assert.equal(env.root().pathsView.text, "x.md");
});

test("the paths are edited in a plain-text JsonView, which keeps the root's paths", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "repo");
	assert.equal(d.state.pathsView.json, false);
	d.send(new Selector().field("pathsView"), "edit", ["a.md\nb.md"]);
	d.drain();
	assert.deepEqual(d.state.pathList, ["a.md", "b.md"]);
	assert.deepEqual(d.problems, []);
});

test("a set_glob call shows the pattern, what it matches and its expectations", async () => {
	const { call, agent } = await toolRunner(ID, "repo");
	const args = { id: "g1", pattern: "src/**/!(*.test).{js,jsx}" };
	const result = await call("set_glob", args);
	assert.equal(result.isError, false);
	const view = agent.scope.make("SetGlobCall", {
		call: { type: "toolCall", id: "c1", name: "set_glob", arguments: args },
		result,
		kind: "message",
	});
	const d = new Driver({ root: view, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		/messageset_globg1 = src\/\*\*\/!\(\*\.test\)\.\{js,jsx\}matches 3\/12 · 3 pass · 0 fail/,
	);
	const broken = await call("set_glob", { id: "g2", pattern: "" });
	const bad = agent.scope.make("SetGlobCall", {
		call: { type: "toolCall", id: "c2", name: "set_glob", arguments: { id: "g2", pattern: "" } },
		result: broken,
		kind: "message",
	});
	assert.equal(bad.state, "doesn't compile");
	assert.deepEqual(d.problems, []);
});

test("glob-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});

test("globs reorder by tool and by drag; encode keeps the order, the tree follows the first", async () => {
	const { call, env, message, registry, agent } = await toolRunner(ID, "repo");
	assert.equal((await call("reorder_globs", { id: "g2", index: 0 })).isError, false);
	assert.equal((await call("reorder_globs", { id: "g9", index: 0 })).isError, true);
	const ids = (root) => registry.encode(agent, root, message).messages.map((m) => m.id);
	assert.deepEqual(ids(env.root()), ["g2", "g1", "g3", "paths"]);
	assert.equal(env.root().focusLabel, "g2: **/*.md");
	const d = new Driver({ root: registry.open(agent, message), document });
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="globs"]');
	dispatchDrag(handles()[2], handles()[0].parentNode);
	d.drain();
	assert.deepEqual(ids(d.state), ["g3", "g1", "g2", "paths"]);
	assert.match(d.rootNode.textContent, /Tree for g3: /);
	d.send(ROOT, "remove_globs_at", [0]);
	d.send(ROOT, "add_globs", []);
	assert.deepEqual(
		d.state.globs.items.map((g) => [g.id, g.pattern]),
		[
			["g1", "src/**/*.{js,jsx}"],
			["g2", "**/*.md"],
			["g3", "**/*"],
		],
	);
	assert.deepEqual(d.problems, []);
});
