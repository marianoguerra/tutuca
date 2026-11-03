// jsonpointer-lab: its section, its tools' parameters, editing through
// message tools, view tools (a query with arguments, a get), the shared
// tools, and the document edited as text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentMeta, openWith } from "../../microagents/agent.js";
import { toolsFor } from "../../microagents/tools.js";
import { agent, bytes, runtime, session } from "./helpers.mjs";

const ID = "jsonpointer-lab";

test("its section says what it is, and its tools take their docs from the .tcd", () => {
	const meta = agentMeta(bytes(`dist/agents/${ID}.wasm`));
	assert.equal(meta.root, "JsonPointerLab");
	assert.equal(meta.tools.find((t) => t.name === "set_pointer").description, "Change a pointer.");
	assert.ok(meta.skills["SKILL.md"]);
});

test("the tools' parameters come from the messages' and queries' arguments", async () => {
	const { tw } = await runtime();
	const a = await agent(ID);
	const tools = toolsFor(tw.runtime, a, openWith(tw, a, a.meta.samples.config));
	const reorder = tools.find((t) => t.name === "reorder_pointers");
	assert.deepEqual(reorder.parameters.required, ["id", "index"]);
	assert.equal(reorder.parameters.properties.index.minimum, 0);
	assert.deepEqual(tools.find((t) => t.name === "resolve").parameters.required, ["pointer"]);
	assert.match(tools.find((t) => t.name === "resolutions").description, /reads, changes nothing/);
});

test("a message tool changes the root and answers with the summary", async () => {
	const s = await session(await agent(ID), "config");
	const out = await s.call("set_pointer", { id: "q3", pointer: "/servers/1/port" });
	assert.equal(out.isError, false, out.content[0].text);
	assert.equal(out.details.changed, true);
	assert.match(out.content[0].text, /q3: "\/servers\/1\/port" → 8081/);
	assert.match(await s.text("add_pointer", { pointer: "/name" }), /q5: "\/name" → "billing"/);
	assert.deepEqual(s.host.issues, []);
});

test("a call with a bad id fails, says why, and changes nothing", async () => {
	const s = await session(await agent(ID), "config");
	const before = s.root();
	const out = await s.call("set_pointer", { id: "nope", pointer: "/x" });
	assert.equal(out.isError, true);
	assert.match(out.content[0].text, /can't run with these arguments now/);
	assert.equal(s.root(), before);
	const typed = await s.call("reorder_pointers", { id: "q1", index: -1 });
	assert.equal(typed.isError, true);
	assert.match(typed.content[0].text, /index/);
});

test("view tools read: a query with its arguments, a get without", async () => {
	const s = await session(await agent(ID), "config");
	const resolve = await s.json("resolve", { pointer: "/routes/~1api~1users" });
	assert.equal(resolve.resolves, true);
	assert.deepEqual(resolve.tokens, ["routes", "/api/users"]);
	const bad = await s.json("resolve", { pointer: "/a~2" });
	assert.equal(bad.resolves, false);
	assert.match(bad.reason, /~ that isn't ~0/);
	assert.equal((await s.json("find", { text: "EXAMPLE" })).count, 2);
	const all = await s.json("resolutions");
	assert.equal(all.length, 4);
	assert.match(all[2].reason, /out of range/);
});

test("the shared tools read the skills, the state and the export", async () => {
	const a = await agent(ID);
	const s = await session(a, "config");
	assert.match(await s.text("skills_list", { dir: "" }), /SKILL\.md/);
	assert.match(await s.text("skills_read", { path: "reference/rfc6901.md" }), /~1/);
	assert.deepEqual(await s.json("export_preview"), a.meta.samples.config);
	assert.equal((await s.call("skills_read", { path: "nope" })).isError, true);
});

test("editing the document as text keeps it while it isn't JSON", async () => {
	const s = await session(await agent(ID), "config");
	s.send("set_document_text", "{ nope");
	assert.match(s.get("doc_error"), /JSON/);
	assert.match(s.get("summary"), /document: not JSON/);
	s.send("set_document_text", '{"a": [1, 2]}');
	assert.equal(s.get("doc_error"), "");
	s.send("pick_node", 2);
	assert.equal(s.get("pointers")[0].pointer, "/a/0");
	assert.deepEqual(s.host.issues, []);
});
