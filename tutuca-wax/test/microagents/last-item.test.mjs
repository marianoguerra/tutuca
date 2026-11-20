// Every lab's remove message (glob-lab's is in its own test) has a `when`
// that keeps the last item, and its handler keeps it too: `when` is only
// checked (and reported) in dev mode, the handler runs regardless.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

// [agent, the message, the lists it removes from (together, at least one stays)]
const CASES = [
	["cron-lab", "removeCron", ["crons"]],
	["datefmt-lab", "removeInstant", ["instants"]],
	["datefmt-lab", "removeFormat", ["strftimes", "intls"]],
	["jq-lab", "removeFilter", ["filters"]],
	["jq-lab", "removeInput", ["inputs"]],
	["json-schema-lab", "removeExample", ["examples"]],
	["jsonpath-lab", "removePath", ["paths"]],
	["jsonpointer-lab", "removePointer", ["pointers"]],
	["regex-lab", "removeRegex", ["regexes"]],
	["regex-lab", "removeText", ["texts"]],
];

for (const [id, message, lists] of CASES) {
	test(`${id}'s ${message} keeps the last one: \`when\` only reports, the handler guards`, async () => {
		const a = await agent(id);
		const s = await session(a, Object.keys(a.meta.samples)[0]);
		const ids = () => lists.flatMap((name) => s.get(name).map((item) => item.id));
		for (const each of ids().slice(1)) s.send(message, each);
		assert.deepEqual(s.host.issues, []);
		const [last] = ids();
		assert.deepEqual(ids(), [last]);
		const before = lists.map((name) => s.get(name));
		s.send(message, last);
		assert.deepEqual(
			lists.map((name) => s.get(name)),
			before,
		);
		assert.deepEqual(
			s.host.issues.map((i) => i.type),
			["messageInvalid"],
		);
	});
}
