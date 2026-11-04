// Every lab's remove message (glob-lab's is in its own test) has a `when`
// that keeps the last item, and its handler keeps it too: `when` is only
// checked (and reported) in dev mode, the handler runs regardless.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

// [agent, the message, the lists it removes from (together, at least one stays)]
const CASES = [
	["cron-lab", "remove_cron", ["crons"]],
	["datefmt-lab", "remove_instant", ["instants"]],
	["datefmt-lab", "remove_format", ["strftimes", "intls"]],
	["jq-lab", "remove_filter", ["filters"]],
	["jq-lab", "remove_input", ["inputs"]],
	["json-schema-lab", "remove_example", ["examples"]],
	["jsonpath-lab", "remove_path", ["paths"]],
	["jsonpointer-lab", "remove_pointer", ["pointers"]],
	["regex-lab", "remove_regex", ["regexes"]],
	["regex-lab", "remove_text", ["texts"]],
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
