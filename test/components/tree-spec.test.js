import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { treeSpecComponents } from "../../components/tree-spec/index.js";
import { explorerOf, worldOf } from "../../components/tree-spec/model.js";
import { Driver } from "../../src/test/driver.js";
import { document, scopeWith, testLintsClean } from "../helpers.js";

testLintsClean("tree spec", treeSpecComponents);

const DIR = new URL("../../demos/tree-spec/scenarios/", import.meta.url);
const scenario = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8"));
const names = readdirSync(DIR)
	.filter((f) => f.endsWith(".json") && f !== "index.json")
	.map((f) => f.slice(0, -5));
const C = scopeWith(treeSpecComponents).components;
const start = (name) => new Driver({ root: explorerOf(C, scenario(name)), document });
const click = (d, el) => {
	el.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true }));
	d.drain();
};
const choices = (d) => [...d.rootNode.querySelectorAll("section button.btn-outline")];

test("every exported scenario renders, and every state can be reached by its choices", () => {
	assert.ok(names.length > 5);
	for (const name of names) {
		const d = start(name);
		assert.deepEqual(d.problems, [], name);
		const json = scenario(name);
		const seen = new Set([0]);
		// Depth first through the choices, going back after each one.
		const visit = () => {
			const here = d.state.current;
			for (let i = 0; i < choices(d).length; i++) {
				const before = d.state.current;
				click(d, choices(d)[i]);
				assert.notEqual(d.state.current, before, `${name}: a choice moves`);
				if (!seen.has(d.state.current)) {
					seen.add(d.state.current);
					visit();
				}
				click(d, d.rootNode.querySelector("section button"));
				assert.equal(d.state.current, here, `${name}: back returns`);
			}
		};
		visit();
		assert.equal(seen.size, json.states.length, `${name}: reaches every state`);
		assert.deepEqual(d.problems, [], name);
	}
});

test("a misdelivery is drawn red and noted, by path, and not by identity", () => {
	const misroutes = (json) =>
		json.states.some((s) =>
			worldOf(C, s, json.policy).inflight.some((m) => m.status === "misroute"),
		);
	assert.equal(misroutes(scenario("replace-by-path")), true);
	assert.equal(misroutes(scenario("replace-by-identity")), false);
	const json = scenario("replace-by-path");
	const state = json.states.find((s) =>
		worldOf(C, s, json.policy).arrows.some((a) => a.status === "misroute"),
	);
	assert.ok(state, "some state has a red arrow");
});

test("anchored, a send-at that went elsewhere also points to where it was meant to go", () => {
	const json = scenario("reorder-anchored");
	const worlds = json.states.map((s) => worldOf(C, s, json.policy));
	assert.ok(worlds.some((w) => w.arrows.some((a) => a.status === "meant")));
});

test("clicking an instance selects it and shows its card", () => {
	const d = start("hops");
	const nodes = d.rootNode.querySelectorAll(".ts-instance > g.cursor-pointer");
	assert.equal(nodes.length, 3);
	click(d, nodes[2]);
	const world = d.state.states[d.state.current];
	assert.notEqual(world.selected, -1);
	assert.match(d.rootNode.textContent, /Counter #\d/);
	assert.deepEqual(d.problems, []);
});

test("the observations new in a step are marked fresh", () => {
	const d = start("requests");
	click(d, choices(d)[0]);
	assert.ok(d.rootNode.querySelector("li.font-bold"), "the new observations are bold");
	assert.deepEqual(d.problems, []);
});
