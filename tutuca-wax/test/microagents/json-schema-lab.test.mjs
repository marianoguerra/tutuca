// json-schema-lab: the examples validated against the schema (Ajv, through
// the json_schema host functions), the expectations, the schema patched at a
// pointer, the schema and examples edited as text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agent, session } from "./helpers.mjs";

const ID = "json-schema-lab";

test("the sample's validation says which expectations hold", async () => {
	const s = await session(await agent(ID), "user");
	assert.equal(s.get("headline"), "3 pass · 1 fail");
	const v = await s.json("validation");
	assert.equal(v.schemaError, undefined);
	assert.deepEqual(
		v.examples.map((x) => [x.id, x.expected, x.valid, x.status, x.errors]),
		[
			["e1", "pass", true, "pass", 0],
			["e2", "fail", false, "pass", 1],
			["e3", "fail", false, "pass", 1],
			["e4", "pass", false, "fail", 1],
		],
	);
	assert.match(s.get("summary"), /e4: .*"nickname":"D".* expects pass, invalid \(1 errors\) → fail/);
	assert.equal(s.get("result_rows")[2].errors, "/age: must be >= 0");
});

test("errors_for says why; a bad id is an error", async () => {
	const s = await session(await agent(ID), "user");
	const out = await s.json("errors_for", { id: "e4" });
	assert.deepEqual(out, {
		valid: false,
		expected: "pass",
		errors: [{ instancePath: "", keyword: "additionalProperties", message: "must NOT have additional properties" }],
	});
	assert.equal((await s.call("errors_for", { id: "e9" })).isError, true);
});

test("patch_schema sets a value at a pointer and answers with the validation", async () => {
	const s = await session(await agent(ID), "user");
	const out = await s.json("patch_schema", { pointer: "/properties/nickname", value: { type: "string" } });
	assert.deepEqual(out.examples.map((x) => x.status), ["pass", "pass", "pass", "pass"]);
	assert.deepEqual(s.get("schema").properties.nickname, { type: "string" });
	await s.call("patch_schema", { pointer: "/required/-", value: "age" });
	assert.deepEqual(s.get("schema").required, ["id", "name", "email", "age"]);
	assert.equal(s.get("headline"), "3 pass · 1 fail");
	assert.equal((await s.json("validation")).examples[3].status, "fail");
	assert.deepEqual(s.host.issues, []);
});

test("a pointer whose parent is missing is rejected and changes nothing", async () => {
	const s = await session(await agent(ID), "user");
	const before = s.get("schema");
	const out = await s.call("patch_schema", { pointer: "/properties/nope/type", value: "string" });
	assert.equal(out.isError, true);
	assert.match(out.content[0].text, /parent_in_schema/);
	assert.deepEqual(s.get("schema"), before);
	assert.equal((await s.call("remove_from_schema", { pointer: "/properties/zzz" })).isError, true);
});

test("remove_from_schema drops a keyword", async () => {
	const s = await session(await agent(ID), "user");
	await s.call("remove_from_schema", { pointer: "/additionalProperties" });
	assert.equal(s.get("schema").additionalProperties, undefined);
	assert.equal(s.get("headline"), "4 pass · 0 fail");
	assert.deepEqual(s.host.issues, []);
});

test("a schema that doesn't compile makes every example invalid, and says why", async () => {
	const s = await session(await agent(ID), "user");
	await s.call("set_schema", { schema: { type: "nope" } });
	assert.equal(s.get("headline"), "0 pass · 0 fail · 4 can't run");
	assert.match((await s.json("validation")).schemaError, /the schema is invalid/);
	assert.match(s.get("schema_problem"), /schema is invalid/);
});

test("the schema edited as text: kept while it isn't JSON, patching waits", async () => {
	const s = await session(await agent(ID), "user");
	s.send("set_schema_text", '{"type": ');
	assert.notEqual(s.get("schema_error"), "");
	assert.equal(s.get("schema_editor_text"), '{"type": ');
	assert.match(s.get("headline"), /4 can't run/);
	assert.equal((await s.call("patch_schema", { pointer: "/type", value: "object" })).isError, true);
	s.send("set_schema_text", '{"type": "object"}');
	assert.equal(s.get("schema_error"), "");
	assert.equal(s.get("headline"), "2 pass · 2 fail");
});

test("examples: added, set, flipped, edited as text, removed, reordered", async () => {
	const s = await session(await agent(ID), "user");
	await s.call("add_example", { value: { id: 0, name: "Zed", email: "z@example.com" }, outcome: "fail" });
	assert.deepEqual(s.get("examples").map((x) => x.id), ["e1", "e2", "e3", "e4", "e5"]);
	assert.equal((await s.json("validation")).examples[4].status, "pass");
	assert.equal((await s.call("add_example", { value: {}, outcome: "maybe" })).isError, true);
	await s.call("set_example", { id: "e5", value: { id: 5, name: "Zed", email: "z@example.com" } });
	assert.equal((await s.json("validation")).examples[4].status, "fail");
	await s.call("set_expectation", { id: "e5", outcome: "pass" });
	assert.equal((await s.json("validation")).examples[4].status, "pass");
	s.send("set_example_text", "e5", "{oops");
	assert.equal(s.get("example_rows")[4].text, "{oops");
	assert.notEqual(s.get("example_rows")[4].error, "");
	assert.equal((await s.json("validation")).examples[4].status, "invalid");
	s.send("set_example_text", "e5", '{"id": 9, "name": "N", "email": "n@example.com"}');
	assert.equal(s.get("examples")[4].value.id, 9);
	assert.equal((await s.json("validation")).examples[4].status, "pass");
	await s.call("reorder_examples", { id: "e5", index: 0 });
	assert.equal(s.get("examples")[0].id, "e5");
	await s.call("remove_example", { id: "e5" });
	assert.equal(s.get("examples").length, 4);
	assert.equal((await s.call("remove_example", { id: "e9" })).isError, true);
	assert.equal(s.get("examples").length, 4);
	assert.deepEqual(s.host.issues, []);
});

test("the data is the JSON it opened, changed", async () => {
	const s = await session(await agent(ID), "user");
	await s.call("set_expectation", { id: "e4", outcome: "fail" });
	const data = s.get("data");
	assert.deepEqual(Object.keys(data).sort(), ["examples", "schema"]);
	assert.deepEqual(data.examples[3], { id: "e4", value: { id: 4, name: "Dee", email: "dee@example.com", nickname: "D" }, outcome: "fail" });
});
