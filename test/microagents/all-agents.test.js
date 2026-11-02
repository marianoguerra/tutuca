// Every agent folder, together: each one passes the check the Agent Builder runs, and every
// sample opens with its own agent (and only with agents that are meant to share it).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { AGENTS_URL } from "../../apps/microagents/app.js";
import { checkAgent, reportText } from "../../apps/microagents/core/check.js";
import { packAgent } from "../../apps/microagents/core/pack.js";
import { makeKit } from "../../apps/microagents/kit.js";
import { loadAgents, readAgentFile } from "./helpers.js";

const IDS = readdirSync(AGENTS_URL, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort();
// Samples more than one agent opens on purpose.
const SHARED = { sales: ["echarts-lab", "vega-lite-lab"] };

test("there are agents", () => {
	assert.ok(IDS.length >= 14, IDS.join(", "));
});

for (const id of IDS) {
	test(`${id} passes the agent check`, async () => {
		const msg = await packAgent(readAgentFile, id);
		const { ok, items } = await checkAgent(msg, makeKit());
		assert.ok(ok, reportText(items));
	});
}

test("every sample opens with its own agent and no unexpected one", async () => {
	const registry = await loadAgents(IDS);
	const wrong = [];
	for (const agent of registry.list()) {
		for (const { id, message } of agent.samples) {
			if (id === "empty" || agent.id === "agent-builder") continue;
			const got = registry
				.match(message)
				.matches.map((m) => m.agent.id)
				.sort();
			const want = SHARED[id] ?? [agent.id];
			if (JSON.stringify(got) !== JSON.stringify(want))
				wrong.push(`${agent.id}/${id}: ${got.join(", ") || "none"}`);
		}
	}
	assert.deepEqual(wrong, []);
});
