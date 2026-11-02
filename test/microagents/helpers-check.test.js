import assert from "node:assert/strict";
import test from "node:test";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

test("the helpers drive an agent and run its tools", async () => {
	const { registry, agent } = await loadAgent("regex-lab");
	const { d } = drive(registry, agent, "emails");
	d.send(ROOT, "add_text", ["x"]);
	assert.equal(d.state.texts.items.length, 5);
	assert.deepEqual(lintErrors(agent), []);
	const { call, text } = await toolRunner("regex-lab", "emails");
	const r = await call("set_regex", { id: "r9", pattern: "a", flags: "" });
	assert.equal(r.isError, true);
	assert.match(text(await call("add_text", { text: "y" })), /5 texts/);
});
