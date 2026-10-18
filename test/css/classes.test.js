import assert from "node:assert/strict";
import test from "node:test";
import { collectClasses } from "../../src/css/classes.js";
import { $if, each, field, h } from "../../src/tutuca.js";

test("collectClasses finds constant classes in nested $if branches", () => {
	const v = h(
		"div",
		{ class: "flex  gap-2" },
		h("span", {
			class: $if(field("a"), $if(field("b"), "x y", "z"), "w"),
		}),
		h("span", { class: field("dynamic"), title: "not-a-class" }),
		each(field("items"), h("i", { class: "item" })),
	);
	assert.deepEqual(collectClasses(v), new Set(["flex", "gap-2", "x", "y", "z", "w", "item"]));
	const all = new Set(["kept"]);
	assert.equal(collectClasses(v, all), all);
	assert.ok(all.has("kept") && all.has("item"));
});
