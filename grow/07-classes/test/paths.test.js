// The scenarios of spec/component/paths.rkt.
import assert from "node:assert/strict";
import test from "node:test";
import { getIn, setIn } from "../src/component/paths.js";

const root = {
	selected: 1,
	items: [
		{ count: 0, kids: [] },
		{ count: 5, kids: [{ count: 7 }] },
	],
	child: { count: 2 },
};

test("getIn reads one property per key", () => {
	assert.equal(getIn([], root), root);
	assert.equal(getIn(["child", "count"], root), 2);
	assert.equal(getIn(["items", 1, "count"], root), 5);
	assert.equal(getIn(["items", 1, "kids", 0, "count"], root), 7);
});

test("a missing key reads as nothing, and reading below it throws", () => {
	assert.equal(getIn(["missing"], root), undefined);
	assert.throws(() => getIn(["missing", "x", "y"], root), TypeError);
});

test("setIn gives a new root", () => {
	const next = setIn(["items", 1, "count"], root, 6);
	assert.equal(getIn(["items", 1, "count"], next), 6);
	assert.equal(setIn([], root, 1), 1);
});

test("setIn leaves the old root as it was and shares what is off the path", () => {
	const next = setIn(["items", 1, "count"], root, 6);
	assert.equal(getIn(["items", 1, "count"], root), 5);
	assert.equal(next.child, root.child);
	assert.equal(next.items[0], root.items[0]);
	assert.notEqual(next.items, root.items);
});
