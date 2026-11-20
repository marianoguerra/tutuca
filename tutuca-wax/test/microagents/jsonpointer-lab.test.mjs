// jsonpointer-lab: its section, its tools' parameters, editing through
// message tools, view tools (a query with arguments, a get), the shared
// tools, and the document edited as text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentMeta, openWith } from "../../microagents/agent.js";
import { toolsFor } from "../../microagents/tools.js";
import { agent, bytes, runtime, session } from "./helpers.mjs";

const ID = "jsonpointer-lab";

test("its section says what it is, and its tools take their docs from the module", () => {
	const meta = agentMeta(bytes(`dist/agents/${ID}.wasm`));
	assert.equal(meta.root, "JsonPointerLab");
	assert.equal(meta.tools.find((t) => t.name === "setPointer").description, "Change a pointer.");
	assert.ok(meta.skills["SKILL.md"]);
});

test("the tools' parameters come from the messages' and queries' arguments", async () => {
	const { tw } = await runtime();
	const a = await agent(ID);
	const tools = toolsFor(tw.runtime, a, openWith(tw, a, a.meta.samples.config));
	const reorder = tools.find((t) => t.name === "reorderPointers");
	assert.deepEqual(reorder.parameters.required, ["id", "index"]);
	assert.equal(reorder.parameters.properties.index.minimum, 0);
	assert.deepEqual(tools.find((t) => t.name === "resolve").parameters.required, ["pointer"]);
	assert.match(tools.find((t) => t.name === "resolutions").description, /reads, changes nothing/);
});

test("a message tool changes the root and answers with the summary", async () => {
	const s = await session(await agent(ID), "config");
	const out = await s.call("setPointer", { id: "q3", pointer: "/servers/1/port" });
	assert.equal(out.isError, false, out.content[0].text);
	assert.equal(out.details.changed, true);
	assert.match(out.content[0].text, /q3: "\/servers\/1\/port" → 8081/);
	assert.match(await s.text("addPointer", { pointer: "/name" }), /q5: "\/name" → "billing"/);
	assert.deepEqual(s.host.issues, []);
});

test("a call with a bad id fails, says why, and changes nothing", async () => {
	const s = await session(await agent(ID), "config");
	const before = s.root();
	const out = await s.call("setPointer", { id: "nope", pointer: "/x" });
	assert.equal(out.isError, true);
	assert.match(out.content[0].text, /can't run with these arguments now/);
	assert.equal(s.root(), before);
	const typed = await s.call("reorderPointers", { id: "q1", index: -1 });
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
	assert.match(await s.text("skillsList", { dir: "" }), /SKILL\.md/);
	assert.match(await s.text("skillsRead", { path: "reference/rfc6901.md" }), /~1/);
	assert.deepEqual(await s.json("exportPreview"), a.meta.samples.config);
	assert.equal((await s.call("skillsRead", { path: "nope" })).isError, true);
});

test("editing the document as text keeps it while it isn't JSON", async () => {
	const s = await session(await agent(ID), "config");
	s.send("setDocumentText", "{ nope");
	assert.match(s.get("docError"), /JSON/);
	assert.match(s.get("summary"), /document: not JSON/);
	s.send("setDocumentText", '{"a": [1, 2]}');
	assert.equal(s.get("docError"), "");
	s.send("pickNode", 2);
	assert.equal(s.get("pointers")[0].pointer, "/a/0");
	assert.deepEqual(s.host.issues, []);
});
