// The studio's server (scripts/studio-server.mjs) on its own: the models it
// offers out of pi-ai's catalog (scripts/studio-models.mjs), and the system
// prompt it builds. The assistant's loop runs in test/browser.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { modelRule, MODEL_RULES, normalizedId } from "../scripts/studio-models.mjs";
import { systemPrompt } from "../scripts/studio-server.mjs";
import { diagnosticReport, spanExcerpt } from "../studio/assistant.js";

const catalog = builtinModels();
const all = catalog.getProviders().flatMap((p) => catalog.getModels(p.id).map((m) => ({ provider: p.id, id: m.id })));

test("each model rule matches a model of pi-ai's catalog", () => {
	for (const rule of MODEL_RULES) {
		assert.ok(all.some((m) => rule.match.test(normalizedId(m.id))), `${rule.family} ${rule.size ?? ""}: ${rule.match}`);
	}
});

test("the rules offer the generations asked for, from any provider, and nothing else", () => {
	const offered = (provider, id) => modelRule(id) !== null && all.some((m) => m.provider === provider && m.id === id);
	assert.ok(offered("openai", "gpt-6-sol"));
	assert.ok(offered("openai", "gpt-5.6-luna"));
	assert.ok(!offered("openai", "gpt-5.5"));
	assert.ok(!offered("openai", "gpt-4o"));
	assert.ok(offered("anthropic", "claude-opus-5-5"));
	assert.ok(offered("anthropic", "claude-sonnet-5"));
	assert.ok(!offered("anthropic", "claude-opus-4-8"));
	assert.ok(!offered("anthropic", "claude-fable-5-1"));
	assert.ok(offered("deepseek", "deepseek-v4-pro"));
	assert.ok(offered("xai", "grok-4.7"));
	assert.ok(!offered("xai", "grok-4.6"));
	// Through aggregators and clouds, under their own ids.
	assert.equal(normalizedId("anthropic/claude-opus-5.5"), "claude-opus-5.5");
	assert.equal(normalizedId("us.xai.grok-4.7"), "grok-4.7");
	assert.equal(normalizedId("accounts/fireworks/models/glm-5p3-flash"), "glm-5.3-flash");
	assert.ok(modelRule("openrouter/anthropic/claude-opus-5.5"));
	assert.equal(modelRule("glm-5.3-fast"), null);
	assert.equal(modelRule("kimi-k3:batch"), null);
});

test("the system prompt has the reference, the examples, the runtime's functions and the component", async () => {
	const prompt = await systemPrompt({ name: "mine", tcd: "package tutuca:mine@0.1.0;", wax: "// nothing" });
	for (const part of ["# You are the tutuca-wax studio's assistant", "# The .tcd language", "## Example: note", "fn list_push(list: &value, item: &value) -> &value;", "fn value_member(v: &value, name: js_string) -> &value;", "# The module you're editing: mine", "package tutuca:mine@0.1.0;", "### Operators: i32 and f64 differ", "### What Wax doesn't have", "## When it doesn't build", "## Example: score", "fn int_max(a: i32, b: i32) -> i32;", "fn int_clamp(n: i32, lo: i32, hi: i32) -> i32;"]) {
		assert.ok(prompt.includes(part), part);
	}
});

// What the model reads of a diagnostic: the line it points at, with carets
// under the place, and its related places' lines too.
test("a diagnostic as the model reads it shows the line it points at, and its related places", () => {
	const sources = { "s.wax": "fn f() -> i32 {\n    if a >= 30 { return 1; }\n    0;\n}\n" };
	const at = (line, col, end = col) => ({ file: "s.wax", start: { line, col }, end: { line, col: end } });
	assert.equal(spanExcerpt(at(2, 10, 12), sources), "\n  2 |     if a >= 30 { return 1; }\n    |          ^^");
	assert.equal(spanExcerpt(at(2, 10), { other: "" }), "");
	const d = { span: at(2, 10, 12), severity: "error", code: "wax", message: "Nope.", hint: "write >=s", related: [{ span: at(3, 5, 6), message: "and here" }] };
	assert.equal(
		diagnosticReport(d, sources),
		"s.wax:2:10: error wax: Nope. (write >=s)\n  2 |     if a >= 30 { return 1; }\n    |          ^^\n  at s.wax:3:5: and here\n  3 |     0;\n    |     ^",
	);
});
