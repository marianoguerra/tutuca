import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Driver } from "../../src/test/driver.js";
import { dispatchDrag } from "../../src/test/pbt.js";
import { Selector } from "../../src/tutuca.js";
import { document } from "../helpers.js";
import { drive, lintErrors, loadAgent, ROOT, toolRunner } from "./helpers.js";

const ID = "blockkit-lab";
const button = (text, extra = {}) => ({
	type: "button",
	text: { type: "plain_text", text },
	...extra,
});

test("the incident sample matches blockkit-lab, the empty one decodes", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { matches } = registry.match(registry.sample(agent, "incident"));
	assert.ok(matches.some((m) => m.agent.id === ID));
	const { d } = drive(registry, agent, "empty");
	assert.equal(d.state.blocks.length, 0);
	assert.equal(d.state.headline, "0 blocks · 0 problems");
});

test("decode then encode gives back the same bytes", async () => {
	const { registry, agent } = await loadAgent(ID);
	for (const id of ["empty", "incident"]) {
		const msg = registry.sample(agent, id);
		const out = registry.encode(agent, registry.open(agent, msg), msg);
		assert.equal(encodeMessage(out), encodeMessage(msg));
	}
});

test("the preview renders blocks and a mrkdwn subset", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "incident");
	const s = d.state;
	assert.deepEqual(s.problems, []);
	const section = s.preview[1];
	assert.ok(section.isSection);
	const bold = section.segs.find((x) => x.text === "Severity:");
	assert.match(bold.cls, /font-bold/);
	assert.match(section.segs.find((x) => x.text === "Investigating").cls, /italic/);
	assert.match(section.segs.find((x) => x.text === "POST /checkout").cls, /font-mono/);
	const link = section.segs.find((x) => x.isLink);
	assert.deepEqual(
		[link.text, link.href],
		["the status page", "https://status.example.com/inc/2041"],
	);
	assert.deepEqual(section.accButtons, [{ label: "Acknowledge", cls: "btn btn-sm btn-success" }]);
	assert.ok(s.preview[2].fields[2].segs.some((x) => x.text === "@U024BE7LH"));
	assert.match(s.preview[4].elements[1].segs.find((x) => x.text === "SEV-3").cls, /line-through/);
	assert.deepEqual(
		s.preview[5].buttons.map((b) => b.cls),
		["btn btn-sm btn-outline", "btn btn-sm btn-success", "btn btn-sm btn-error"],
	);
	const text = s.preview_text.split("\n");
	assert.equal(text[0], "# 🚨 Incident INC-2041: Checkout API errors");
	assert.ok(text.includes("----"));
	assert.ok(text.includes("[Open runbook] [Join war room] [Declare resolved]"));
	assert.match(
		s.preview_text,
		/See the status page \(https:\/\/status\.example\.com\/inc\/2041\)\./,
	);
	assert.match(d.rootNode.textContent, /Join war room/);
	assert.equal(JSON.parse(s.payloadText).text, "Incident INC-2041: Checkout API errors");
});

test("problems follow Slack's limits", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "incident");
	d.send(ROOT, "add_block", [
		{ type: "header", block_id: "title", text: { type: "mrkdwn", text: "x".repeat(151) } },
		null,
	]);
	d.send(ROOT, "add_block", [
		{ type: "section", fields: Array.from({ length: 11 }, () => ({ type: "mrkdwn", text: "f" })) },
		null,
	]);
	d.send(ROOT, "add_block", [
		{ type: "actions", elements: [button("y".repeat(76), { style: "warning" })] },
		null,
	]);
	d.send(ROOT, "add_block", [
		{ type: "section", text: { type: "mrkdwn", text: "z".repeat(3001) } },
		null,
	]);
	d.send(ROOT, "add_block", [
		{ type: "actions", elements: Array.from({ length: 26 }, (_, i) => button(`b${i}`)) },
		null,
	]);
	d.send(ROOT, "add_block", [{ type: "carousel" }, null]);
	d.drain();
	const problems = d.state.problems.map((x) => `${x.index} ${x.path}: ${x.message}`);
	assert.deepEqual(problems, [
		'7 blocks[7].block_id: "title" is also block 0\'s id',
		"7 blocks[7].text.type: must be plain_text",
		"7 blocks[7].text.text: is 151 characters, more than 150",
		"8 blocks[8].fields: has 11 fields, more than 10",
		"9 blocks[9].elements[0].text.text: is 76 characters, more than 75",
		"9 blocks[9].elements[0].style: must be primary or danger",
		"10 blocks[10].text.text: is 3001 characters, more than 3000",
		"11 blocks[11].elements: must have 1 to 25 elements, has 26",
		'12 blocks[12].type: "carousel" isn\'t a block type this lab knows (section, header, divider, context, actions, image, input)',
	]);
	for (let i = 0; i < 40; i++) d.send(ROOT, "add_template", ["divider"]);
	d.drain();
	assert.equal(d.state.problems[0].message, "has 53 blocks, more than 50");
	assert.deepEqual(d.problems, []);
});

test("the page edits blocks: select, JSON, quick text, drag", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "incident");
	d.send(ROOT, "select", [0]);
	d.send(ROOT, "set_quick_text", ["Incident resolved"]);
	d.drain();
	assert.equal(d.state.blocks[0].text.text, "Incident resolved");
	d.send(ROOT, "select", [3]);
	d.send(ROOT, "edit_json", ["block", '{"type": "divider", "block_id": "sep"']);
	d.drain();
	assert.notEqual(d.state.draftError, "");
	assert.equal(d.state.blocks[3].block_id, undefined);
	d.send(ROOT, "edit_json", ["block", '{"type": "divider", "block_id": "sep"}']);
	d.drain();
	const handles = () => d.rootNode.querySelectorAll('[data-dragtype="rows"]');
	dispatchDrag(handles()[3], handles()[2].parentNode); // the selected block goes up one
	d.drain();
	assert.equal(d.state.blocks[2].block_id, "sep");
	assert.equal(d.state.selected, 2);
	assert.equal(d.state.rows.items[2].label, "2 · divider #sep");
	d.send(ROOT, "edit_json", ["block", '{"type": "divider"']);
	d.drain();
	dispatchDrag(handles()[0], handles()[0].parentNode); // dropped on itself: nothing moves
	d.drain();
	assert.equal(d.state.blocks[0].type, "header");
	assert.equal(d.state.draft, '{"type": "divider"'); // and the draft stays
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	const blocks = out.messages[0].data.get("blocks");
	assert.equal(blocks[2].get("block_id"), "sep");
	assert.equal(out.messages[0].data.get("text"), "Incident INC-2041: Checkout API errors");
	assert.equal(out.messages[0].meta, message.messages[0].meta);
});

test("the block list: a row selects its block, the remove button, move_block's order is encoded", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "incident");
	const types = () => d.state.blocks.map((b) => b.type);
	const before = types();
	const rowButtons = () => d.rootNode.querySelectorAll('[data-dragtype="rows"] + div button');
	rowButtons()[2].click();
	d.drain();
	assert.equal(d.state.selected, 2);
	assert.ok(rowButtons()[2].className.includes("btn-primary"));
	[...d.rootNode.querySelectorAll('button[title="Remove"]')][1].click(); // before the selection
	d.drain();
	assert.deepEqual(types(), before.toSpliced(1, 1));
	assert.equal(d.state.selected, 1);
	assert.equal(d.state.rows.items[1].label.split(" · ")[0], "1");
	d.send(ROOT, "move_block", [0, 2]);
	d.drain();
	const order = types();
	assert.deepEqual(order, [...before.toSpliced(1, 1).slice(1, 3), before[0], ...before.slice(4)]);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.deepEqual(
		out.messages[0].data.get("blocks").map((b) => b.get("type")),
		order,
	);
});

test("move_block (the model's reorder) is written to the payload; untouched, the part stays", async () => {
	const { call, env, registry, agent, message } = await toolRunner(ID, "incident");
	assert.equal(registry.encode(agent, env.root(), message), message);
	const before = env.root().blocks.map((b) => b.type);
	assert.equal((await call("move_block", { from: 0, to: 3 })).isError, false);
	const out = registry.encode(agent, env.root(), message);
	assert.deepEqual(
		out.messages[0].data.get("blocks").map((b) => b.get("type")),
		[...before.slice(1, 4), before[0], ...before.slice(4)],
	);
	assert.equal(env.root().rows.items[3].label.startsWith("3 · "), true);
});

test("an empty lab grows from templates and matches the query", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d, message } = drive(registry, agent, "empty");
	for (const type of ["header", "section", "divider", "context", "actions", "image", "input"]) {
		d.send(ROOT, "add_template", [type]);
	}
	d.drain();
	assert.equal(d.state.blocks.length, 7);
	assert.deepEqual(d.state.problems, []);
	assert.deepEqual(d.problems, []);
	const out = registry.encode(agent, d.state, message);
	assert.ok(registry.match(out).matches.some((m) => m.agent.id === ID));
});

test("tools add, set, move and remove blocks; bad indexes are errors", async () => {
	const { call, text, env } = await toolRunner(ID, "incident");
	const add = await call("add_block", { block: { type: "divider" }, index: 1 });
	assert.equal(add.isError, false);
	assert.equal(env.root().blocks[1].type, "divider");
	assert.equal(
		(
			await call("add_block", {
				block: '{"type":"header","text":{"type":"plain_text","text":"End"}}',
				index: null,
			})
		).isError,
		false,
	);
	assert.equal(env.root().blocks.at(-1).text.text, "End");
	const set = await call("set_block", {
		index: 1,
		block: { type: "context", elements: [{ type: "plain_text", text: "hi" }] },
	});
	assert.equal(set.isError, false);
	const moved = await call("move_block", { from: 1, to: 0 });
	assert.match(text(moved), /^hi\n# 🚨/);
	assert.equal((await call("remove_block", { index: 0 })).isError, false);
	assert.equal(env.root().blocks.length, 8);
	assert.deepEqual(JSON.parse(text(await call("problems"))), []);
	assert.equal(JSON.parse(text(await call("payload"))).blocks.length, 8);
	assert.equal((await call("remove_block", { index: 99 })).isError, true);
	assert.equal((await call("set_block", { index: 0, block: { nope: 1 } })).isError, true);
	assert.equal((await call("move_block", { from: 0, to: 8 })).isError, true);
	assert.equal((await call("add_block", { block: { type: "divider" }, index: 42 })).isError, true);
});

test("the block editor is an editable JsonView, and the payload a read-only one", async () => {
	const { registry, agent } = await loadAgent(ID);
	const { d } = drive(registry, agent, "incident");
	d.send(ROOT, "select", [3]);
	d.drain();
	assert.equal(JSON.parse(d.state.editor.text).type, "divider");
	d.send(new Selector().field("editor"), "edit", ['{"type":"divider","block_id":"cut"}']);
	d.drain();
	assert.equal(d.state.blocks[3].block_id, "cut");
	assert.equal(JSON.parse(d.state.payloadView.text).blocks[3].block_id, "cut");
	assert.equal(d.state.payloadView.editable, false);
	assert.deepEqual(d.problems, []);
});

test("an add_block call shows the block's type, its text and its problems", async () => {
	const { call, agent } = await toolRunner(ID, "incident");
	const args = {
		block: { type: "header", text: { type: "mrkdwn", text: "All clear" } },
		index: null,
	};
	const result = await call("add_block", args);
	assert.equal(result.isError, false);
	const view = agent.scope.make("BlockCall", {
		call: { type: "toolCall", id: "c1", name: "add_block", arguments: args },
		result,
		kind: "message",
	});
	const d = new Driver({ root: view, document });
	assert.match(
		d.rootNode.querySelector("summary").textContent,
		// The shared frame has one glimpse: the type, where and the text, joined by " · ".
		/messageadd_blockheader · at the end · # All clear1 problem/,
	);
	assert.deepEqual(view.blockProblems, ["block.text.type: must be plain_text"]);
	assert.deepEqual(d.problems, []);
});

test("blockkit-lab's components lint clean", async () => {
	const { agent } = await loadAgent(ID);
	assert.deepEqual(lintErrors(agent), []);
});
