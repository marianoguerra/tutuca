// Scopes: the same name is a different component in two scopes, a scope below finds what the
// ones above it register, and what a page asks of a component without running anything.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { testEnv } from "../../src/testing/driver.js";
import { dom } from "../../test/helpers.js";
import { createRuntime } from "../js/tutuca-wasm.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const dir = "../microagents/";
const { HOST_MODULES } = await import(new URL(`${dir}engines/index.js`, import.meta.url));
const regex = { ...HOST_MODULES.regex.declaration, impls: await HOST_MODULES.regex.make(null) };

const box = (shown) => `
import { div, field } from "tutuca/view";
type Box = { n: number };
const Box = {
	on: { inc: { run(next: Box, []: []) { next.n = next.n + 1; } } },
	view: div(${JSON.stringify(shown)}, field("n")),
};
type Pair = { left: Component; right: Component };
const Pair = { view: div(render(field("left")), render(field("right"))) };
`;
const withRender = (source) => source.replace("{ div, field }", "{ div, field, render }");

const runtime = async () => {
	const page = dom().document;
	const node = page.createElement("main");
	return { node, wasm: await createRuntime({ env: testEnv(), document: page, rootNode: node }) };
};

describe("scopes", () => {
	test("a name is the component of the scope it is made in", async () => {
		const { node, wasm } = await runtime();
		for (const [scope, shown] of [
			[["a"], "a:"],
			[["b"], "b:"],
		]) {
			const loaded = await wasm.load(withRender(box(shown)), { scope });
			assert.deepEqual(loaded.diagnostics, []);
		}
		assert.deepEqual(wasm.names(["a"]), ["Box", "Pair"]);
		assert.deepEqual(wasm.names([]), []);
		wasm.start(
			"Pair",
			{
				left: { $make: "Box", fields: { n: 1 } },
				right: { $make: "Box", scope: ["b"], fields: { n: 5 } },
			},
			{ scope: ["a"] },
		);
		wasm.mount();
		assert.match(node.textContent, /a:1.*b:5/);
		wasm.send("inc", [], { to: ["right"] });
		assert.deepEqual(wasm.state(), { left: { n: 1 }, right: { n: 6 } });
		assert.equal(wasm.typeAt(["right"]), "Box");
		assert.equal(wasm.typeAt([]), "Pair");
		// A scope left makes nothing more; what was made there still runs.
		wasm.leave(["b"]);
		assert.equal(wasm.fits("Box", {}, { scope: ["b"] }).error, "Component Box is not registered");
		wasm.send("inc", [], { to: ["right"] });
		assert.equal(wasm.state().right.n, 7);
	});

	test("a layout below a scope: its init makes, and its holes list, from where it is made", async () => {
		const { node, wasm } = await runtime();
		const at = (name) => `../components/${name}/${name}.tutuca.ts`;
		const meta = read(at("meta"));
		const resolve = () => meta;
		const scope = ["screen 0"];
		for (const name of ["meta", "layout"]) {
			assert.equal((await wasm.load(read(at(name)), { scope, resolve })).ok, true, name);
		}
		assert.equal(
			(await wasm.load(read(at("counter")), { scope: [...scope, "inner"], resolve })).ok,
			true,
		);
		wasm.start(
			"Screen",
			{ content: { $make: "Screen", scope: [...scope, "inner"], fields: { editing: true } } },
			{ scope },
		);
		wasm.mount();
		const hole = [{ item: "items", key: 0 }];
		const inner = ["content", "content"];
		assert.equal(wasm.typeAt([...inner, ...hole]), "Hole");
		wasm.send("showChoices", [], { to: [...inner, ...hole] });
		await wasm.idle();
		const names = wasm.state().content.content.items[0].choices.map((c) => c.name);
		assert.ok(names.includes("Vbox") && names.includes("Counter"), names.join(", "));
		// What it captures is what makes it again, by the names its scope makes it by.
		assert.deepEqual(wasm.capture(inner), {
			$make: "Vbox",
			fields: { items: [{ $make: "Hole", fields: {} }] },
		});
		assert.match(node.innerHTML, /choices/);
	});

	test("an agent in a scope below the kit's: fits, queries, checks and putting back", async () => {
		const { wasm } = await runtime();
		const kit = read(`${dir}kit/kit.tutuca.ts`);
		assert.equal((await wasm.load(kit)).ok, true);
		const scope = ["agent:regex-lab"];
		const loaded = await wasm.load(read(`${dir}agents/regex-lab/agent.tutuca.ts`), {
			scope,
			hostModules: [regex],
			resolve: (spec) => (spec.includes("kit.tutuca") ? kit : null),
		});
		assert.deepEqual(loaded.diagnostics, []);
		assert.deepEqual(loaded.definitions.RegexLab.on.setRegex.names, ["id", "pattern", "flags"]);
		const sample = JSON.parse(read(`${dir}agents/regex-lab/samples/emails.json`));
		assert.equal(wasm.fits("RegexLab", sample, { scope }).ok, true);
		const bad = wasm.fits("RegexLab", { ...sample, regexes: "no" }, { scope });
		assert.equal(bad.ok, false);
		assert.deepEqual(bad.issues, [{ field: "regexes", problem: "invalid" }]);
		assert.equal(wasm.fits("RegexLab", { texts: [] }, { scope }).ok, false);
		wasm.start("RegexLab", sample, { scope });
		assert.equal(typeof wasm.query("summary"), "string");
		const id = wasm.state().regexes[0].id;
		assert.equal(wasm.messageProblem("setRegex", [id, "a+", "g"]), null);
		assert.equal(wasm.messageProblem("setRegex", ["nope", "a+", "g"]), "pre");
		assert.equal(wasm.messageProblem("setRegex", [id, 3, "g"]), "arg:1");
		assert.equal(wasm.messageProblem("nope", []), "unknown");
		const held = wasm.hold([]);
		const before = wasm.state();
		wasm.send("setRegex", [id, "a+", "g"]);
		assert.equal(wasm.state().regexes[0].pattern, "a+");
		wasm.put([], held);
		assert.deepEqual(wasm.state(), before);
	});
});
