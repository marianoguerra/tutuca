import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	AGENTS_URL,
	BUILTIN_AGENTS,
	memoryStore,
	shellComponents,
	startApp,
} from "../../apps/microagents/app.js";
import { assistantMessage, scriptedClient } from "../../apps/microagents/core/llm.js";
import { agentMessage, packAgent, unpackAgent } from "../../apps/microagents/core/pack.js";
import { encodeMessage } from "../../apps/microagents/core/tdata.js";
import { Selector, specOf } from "../../src/tutuca.js";
import { setupHost } from "../helpers.js";

const readText = (path) => readFile(new URL(path, AGENTS_URL), "utf8");
// The open agent at tab i, and where its shell and chat are.
const shellOf = (root, i = 0) => root.sessions[root.order[i]];
const SHELL = (host, i = 0) => new Selector().item("sessions", host.root.order[i]);
const CHAT = (host, i = 0) => SHELL(host, i).field("chat");

const start = async ({ turns = [], store = memoryStore(), llm = scriptedClient(turns) } = {}) => {
	const { host, rootNode } = setupHost(shellComponents);
	const saved = [];
	const files = { saveText: (...a) => saved.push(a), saveBytes: (...a) => saved.push(a) };
	const { registry } = await startApp({ host, readText, llm, store, files });
	const send = async (name, args = [], to = new Selector()) => {
		host.send(name, args, { to });
		await host.whenIdle();
		await new Promise((resolve) => setTimeout(resolve, 0)); // the render after the last task
	};
	return { host, rootNode, llm, registry, saved, send, store };
};

test("the launcher lists the agents; New opens one empty", async () => {
	const { host, rootNode, send } = await start();
	assert.deepEqual(
		host.root.agents.map((a) => a.id),
		BUILTIN_AGENTS,
	);
	assert.match(rootNode.textContent, /Regex lab/);
	await send("start", ["regex-lab", "empty"]);
	assert.equal(host.root.mode, "active");
	assert.equal(shellOf(host.root).workspace.regexes.items.length, 0);
	assert.equal(shellOf(host.root).tab, "chat");
	assert.ok(shellOf(host.root).tools.some((t) => t.name === "set_regex"));
});

test("pasted TData that one agent matches opens in it", async () => {
	const { host, send } = await start();
	const text = await readText("regex-lab/samples/emails.tdata.json");
	await send("setPaste", [text]);
	await send("openPaste");
	assert.equal(host.root.error, "");
	assert.equal(host.root.mode, "active");
	assert.equal(shellOf(host.root).source, "pasted TData");
	assert.equal(shellOf(host.root).workspace.headline, "5 pass · 1 fail · 2 unset");
});

test("TData no agent matches shows what each agent needs", async () => {
	const { host, rootNode, send } = await start();
	await send("setPaste", [
		'{"id":"x","kind":"notes","messages":[{"id":"n","kind":"note","data":"hi"}]}',
	]);
	await send("openPaste");
	assert.equal(host.root.mode, "choosing");
	assert.equal(host.root.picker.choices.length, 0);
	assert.match(rootNode.textContent, /No agent opens pasted TData/);
	assert.match(rootNode.textContent, /one or more regex parts/);
});

test("the chat runs the loop: the model's tool calls change the workspace", async () => {
	const fix = "^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$";
	const { host, llm, send } = await start({
		turns: [
			[{ name: "grid", arguments: {} }],
			[
				"t4 matches r1 but shouldn't.",
				{ name: "set_regex", arguments: { id: "r1", pattern: fix, flags: "" } },
			],
			["Fixed: r1 no longer accepts a second @."],
		],
	});
	await send("start", ["regex-lab", "emails"]);
	await send("setInput", ["make every expectation pass"], CHAT(host));
	await send("send", [], CHAT(host));
	const chat = shellOf(host.root).chat;
	assert.equal(chat.busy, false);
	assert.deepEqual(
		chat.transcript.map((m) => m.role),
		["user", "assistant", "toolResult", "assistant", "toolResult", "assistant"],
	);
	assert.equal(shellOf(host.root).workspace.headline, "6 pass · 0 fail · 2 unset");
	assert.equal(chat.transcript[4].details.changed, true);
	// The chat shows each call: grid in the generic view, set_regex in regex-lab's own.
	assert.deepEqual(
		chat.entries.map((e) => specOf(e).name),
		["ChatBubble", "ToolCall", "ChatBubble", "SetRegexCall", "ChatBubble"],
	);
	assert.equal(chat.entries[1].state, "ok");
	assert.equal(chat.entries[3].regex, "r1 = /^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$/");
	assert.equal(chat.entries[3].state, "6 pass · 0 fail · 2 unset");
	// The model saw the agent's prompt, skills, state and tools.
	const [first, , last] = llm.requests;
	assert.match(first.systemPrompt, /Regex lab/);
	assert.match(first.systemPrompt, /reference\/flags\.md/);
	assert.match(first.systemPrompt, /1 fail/);
	assert.match(last.systemPrompt, /0 fail/);
	assert.ok(first.tools.some((t) => t.name === "set_regex"));
	// Each step carries the whole transcript up to it: the server keeps nothing.
	llm.requests.forEach((request, i) => {
		assert.deepEqual(request.transcript, chat.transcript.slice(0, 2 * i + 1));
		assert.equal(request.model, chat.model);
	});
});

test("the loop stops after its step limit", async () => {
	const loop = Array.from({ length: 20 }, () => [{ name: "grid", arguments: {} }]);
	const { host, send } = await start({ turns: loop });
	await send("start", ["regex-lab", "emails"]);
	await send("setInput", ["loop"], CHAT(host));
	await send("send", [], CHAT(host));
	assert.match(shellOf(host.root).chat.status, /stopped after 12 steps/);
});

test("export writes TData that keeps what the agent didn't touch", async () => {
	const { host, saved, send } = await start();
	await send("start", ["regex-lab", "emails"]);
	await send("download", ["json"], SHELL(host));
	const original = await readText("regex-lab/samples/emails.tdata.json");
	assert.equal(saved[0][0], "emails.tdata.json");
	assert.equal(saved[0][1], encodeMessage(shellOf(host.root).original));
	assert.match(saved[0][1], /"x\/notes":\{"why":"a double @ must fail"\}/);
	assert.ok(original.includes("x/notes"));
});

test("an agent file installs after the trust card, and stays installed", async () => {
	const store = memoryStore();
	const { host, send } = await start({ store });
	const parts = unpackAgent(await packAgent(readText, "regex-lab"));
	const copy = agentMessage({
		...parts,
		manifest: { ...parts.manifest, id: "regex-copy", title: "Regex copy" },
	});
	await send("setPaste", [encodeMessage(copy)]);
	await send("openPaste");
	assert.equal(host.root.mode, "choosing");
	assert.equal(host.root.picker.agent.title, "Regex copy");
	await send("reviewInstall");
	assert.equal(host.root.mode, "trust");
	assert.deepEqual(host.root.trust.tools.slice(0, 2), ["set_regex", "add_regex"]);
	await send("confirmInstall");
	assert.equal(host.root.notice, "Installed Regex copy.");
	assert.deepEqual(
		host.root.agents.map((a) => a.id),
		[...BUILTIN_AGENTS, "regex-copy"],
	);
	// A new page with the same store has it too, and the sample now matches both agents.
	const again = await start({ store });
	assert.deepEqual(
		again.host.root.agents.map((a) => a.id),
		[...BUILTIN_AGENTS, "regex-copy"],
	);
	await again.send("setPaste", [await readText("regex-lab/samples/emails.tdata.json")]);
	await again.send("openPaste");
	assert.deepEqual(
		again.host.root.picker.choices.map((c) => c.id),
		["regex-lab", "regex-copy"],
	);
	await again.send("choose", ["regex-copy"]);
	assert.equal(shellOf(again.host.root).title, "Regex copy");
});

// A model whose answers the test gives, one per request, in any order.
const heldClient = () => {
	const held = [];
	return {
		held,
		models: () => Promise.resolve([{ provider: "scripted", id: "script", name: "Held" }]),
		complete(request, signal) {
			return new Promise((resolve, reject) => {
				held.push({ request, signal, answer: (blocks) => resolve(assistantMessage(blocks)) });
				signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		},
	};
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
// Waits for ok() to hold: the asks in flight here never all settle, so whenIdle won't do.
const until = async (ok, what) => {
	for (let i = 0; i < 400 && !ok(); i++) await tick();
	assert.ok(ok(), `timed out waiting for ${what}`);
};
const say = async (host, llm, i, text) => {
	const before = llm.held.length;
	host.send("setInput", [text], { to: CHAT(host, i) });
	host.send("send", [], { to: CHAT(host, i) });
	await until(() => llm.held.length > before, `the step for "${text}"`);
};

test("two open agents chat at once, each with its own session and data", async () => {
	const llm = heldClient();
	const { host, send } = await start({ llm });
	await send("start", ["regex-lab", "emails"]);
	await send("start", ["regex-lab", "emails"]);
	assert.equal(host.root.order.length, 2);
	assert.equal(host.root.current, host.root.order[1]);
	await say(host, llm, 0, "fix r1");
	await say(host, llm, 1, "just look");
	assert.equal(llm.held.length, 2);
	const [a, b] = llm.held;
	assert.equal(a.request.transcript[0].content, "fix r1");
	assert.equal(b.request.transcript[0].content, "just look");
	// B answers first; A's tool call changes only A's data.
	b.answer(["All good."]);
	await until(() => !shellOf(host.root, 1).chat.busy, "B's answer");
	a.answer([
		{
			name: "set_regex",
			arguments: { id: "r1", pattern: "^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$", flags: "" },
		},
	]);
	await until(() => llm.held.length === 3, "A's step after its tool ran");
	llm.held[2].answer(["Fixed."]);
	await until(() => !shellOf(host.root, 0).chat.busy, "A's last answer");
	const A = shellOf(host.root, 0);
	const B = shellOf(host.root, 1);
	assert.deepEqual(
		A.chat.transcript.map((m) => m.role),
		["user", "assistant", "toolResult", "assistant"],
	);
	assert.deepEqual(
		B.chat.transcript.map((m) => m.role),
		["user", "assistant"],
	);
	assert.equal(A.workspace.headline, "6 pass · 0 fail · 2 unset");
	assert.equal(B.workspace.headline, "5 pass · 1 fail · 2 unset");
	// A's last step saw A's data after its tool ran, and its whole transcript.
	assert.match(llm.held[2].request.systemPrompt, /0 fail/);
	assert.equal(llm.held[2].request.transcript.length, 3);
	assert.equal(A.chat.busy || B.chat.busy, false);
});

test("closing a tab mid-step aborts only that session's step", async () => {
	const llm = heldClient();
	const { host, send } = await start({ llm });
	await send("start", ["regex-lab", "emails"]);
	await send("start", ["regex-lab", "emails"]);
	const [idA, idB] = host.root.order;
	await say(host, llm, 0, "one");
	await say(host, llm, 1, "two");
	host.send("close", [], { to: SHELL(host, 0) });
	await until(() => host.root.order.length === 1, "the tab to close");
	assert.deepEqual(host.root.order, [idB]);
	assert.equal(llm.held[0].signal.aborted, true);
	assert.equal(llm.held[1].signal.aborted, false);
	llm.held[1].answer(["still here"]);
	await until(() => !shellOf(host.root).chat.busy, "B's answer");
	assert.equal(shellOf(host.root).chat.transcript.at(-1).role, "assistant");
	assert.equal(host.root.sessions[idA], undefined);
});

test("tabs: focus switches the shown agent; closing the last goes back to the launcher", async () => {
	const { host, rootNode, send } = await start();
	await send("start", ["regex-lab", "emails"]);
	await send("start", ["regex-lab", "empty"]);
	const [first, second] = host.root.order;
	assert.equal(host.root.current, second);
	await send("focus", [0]);
	assert.equal(host.root.current, first);
	assert.equal(host.root.mode, "active");
	assert.match(rootNode.textContent, /sample: emails/);
	await send("showLauncher");
	assert.equal(host.root.mode, "launcher");
	await send("focus", [0]);
	await send("close", [], SHELL(host, 0));
	assert.equal(host.root.current, second);
	assert.equal(host.root.mode, "active");
	await send("close", [], SHELL(host, 0));
	assert.deepEqual(host.root.order, []);
	assert.equal(host.root.mode, "launcher");
	assert.equal(host.root.current, "");
});

test("Ctrl+Enter in the message sends it; Enter alone doesn't", async () => {
	const { host, rootNode, send, llm } = await start({ turns: [["Hello."]] });
	await send("start", ["regex-lab", "emails"]);
	await send("setTab", [0], SHELL(host)); // the chat
	await send("setInput", ["hi"], CHAT(host));
	const box = rootNode.querySelector('textarea[aria-label="Message"]');
	const { KeyboardEvent } = rootNode.ownerDocument.defaultView;
	box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	await host.whenIdle();
	assert.equal(shellOf(host.root).chat.transcript.length, 0);
	box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
	await host.whenIdle();
	assert.deepEqual(
		shellOf(host.root).chat.transcript.map((m) => m.role),
		["user", "assistant"],
	);
	assert.equal(llm.requests.length, 1);
});
