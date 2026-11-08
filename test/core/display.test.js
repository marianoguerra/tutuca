// The display meta convention: a component's title, icon and description, for whoever shows
// components to people.
import assert from "node:assert/strict";
import test from "node:test";
import {
	component,
	DISPLAY_META,
	displayLabel,
	displayMetaSchemas,
	displayOf,
	Scope,
} from "../../src/tutuca.js";

const Notes = component({
	name: "Notes",
	meta: { [DISPLAY_META]: { title: "Notes", icon: "📝", description: "Short notes." } },
});
const Bare = component({ name: "Bare" });
const Titled = component({ name: "Titled", meta: { [DISPLAY_META]: { title: "Titled" } } });

test("displayOf reads what a component declares, filled with nulls where the schema is", () => {
	const scope = new Scope();
	scope.registerMetaSchemas(displayMetaSchemas);
	scope.register({ Notes, Bare, Titled });
	assert.deepEqual(
		{ ...displayOf(scope.make("Titled", {})) },
		{
			title: "Titled",
			icon: null,
			description: null,
		},
	);
	assert.deepEqual(
		{ ...displayOf(Notes, scope) },
		{
			title: "Notes",
			icon: "📝",
			description: "Short notes.",
		},
	);
	// Without the schema, only what's declared.
	assert.deepEqual({ ...displayOf(Titled) }, { title: "Titled" });
});

test("displayLabel is the icon and the title, or null without a title", () => {
	assert.equal(displayLabel(Notes), "📝 Notes");
	assert.equal(displayLabel(Titled), "Titled");
	assert.equal(displayLabel(Bare), null);
});

test("a scope with the schema rejects display meta of the wrong shape", () => {
	const scope = new Scope();
	scope.registerMetaSchemas(displayMetaSchemas);
	const Wrong = component({ name: "Wrong", meta: { [DISPLAY_META]: { icon: 5 } } });
	assert.throws(() => scope.register({ Wrong }), /icon/);
	const Extra = component({ name: "Extra", meta: { [DISPLAY_META]: { color: "red" } } });
	assert.throws(() => scope.register({ Extra }), /no key color/);
});
