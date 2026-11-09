import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../../src/dev/formatters.js";
import { Driver } from "../../src/testing/driver.js";
import { Scope } from "../../src/tutuca.js";
import { Leaf } from "../helpers.js";

test("every record a host reports says what it is in words, not how many entries it has", () => {
	const scope = new Scope();
	scope.register({ Leaf });
	const driver = new Driver({ root: scope.make("Leaf", {}) });
	driver.send("nothingHandlesThis");
	assert.ok(driver.transitions.length > 0);
	for (const record of driver.reports) {
		const { title } = summarize(record);
		assert.doesNotMatch(title, /entr(y|ies)$/, title);
	}
	const [transition] = driver.transitions;
	assert.equal(summarize(transition).title, "send “nothingHandlesThis” unhandled");
	assert.equal(summarize(transition).detail, "to the root");
	assert.equal(summarize(driver.hostEvents[0]).title, "host event started");
});

test("a value that is no tutuca value is summarized in a few words", () => {
	assert.deepEqual(summarize([1, 2]), { title: "list of 2", detail: "" });
	assert.deepEqual(summarize("hi"), { title: "“hi”", detail: "" });
});
