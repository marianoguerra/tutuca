import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { component, field, Host, h, t } from "../src/tutuca.js";

const page = () => {
	const { document } = new JSDOM("<main></main>").window;
	return { document, rootNode: document.querySelector("main") };
};

const Counter = component({
	name: "Counter",
	fields: { n: t.number() },
	view: h("p", { title: field("label") }, "count: ", field("n")),
	on: {
		inc: {
			pure: true,
			args: [t.number()],
			run(next, [by]) {
				next.n = this.n + by;
			},
		},
	},
	queries: {
		get label() {
			return `${this.n} clicks`;
		},
	},
});

test("the page follows the value", () => {
	const { document, rootNode } = page();
	const host = new Host({ document, rootNode });
	const C = host.scope.register({ Counter });
	host.start(C.Counter());
	assert.equal(rootNode.innerHTML, '<p title="0 clicks">count: 0</p>');
	const p = rootNode.firstChild;
	host.apply("inc", [2]);
	assert.equal(rootNode.innerHTML, '<p title="2 clicks">count: 2</p>');
	assert.equal(host.query("label"), "2 clicks");
	// The same element, patched.
	assert.equal(rootNode.firstChild, p);
});
