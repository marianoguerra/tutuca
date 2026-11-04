// Component metadata: what a component says about itself to hosts, by namespace URI, checked
// against the schemas a scope registers for those URIs and read with their defaults by metaOf.
import assert from "node:assert/strict";
import test from "node:test";
import { component, metaOf, Scope, t } from "../../src/tutuca.js";

const CANVAS = "https://example.com/meta/canvas";
const OTHER = "urn:example:other";
const shape = {
	title: t.option(t.string()),
	width: t.option(t.number().int().min(0)),
	transparent: t.boolean(false),
};
const Card = component({
	name: "Card",
	meta: { [CANVAS]: { title: "Card", width: 320 }, [OTHER]: { anything: [1, 2] } },
});

test("a component's meta is frozen data by URI, {} for none", () => {
	assert.deepEqual(Card.meta[CANVAS], { title: "Card", width: 320 });
	assert.ok(Object.isFrozen(Card.meta) && Object.isFrozen(Card.meta[CANVAS]));
	assert.deepEqual({ ...component({ name: "Bare" }).meta }, {});
});

test("meta keys must be URIs and their values objects", () => {
	assert.throws(
		() => component({ name: "A", meta: { canvas: {} } }),
		/meta key canvas isn't a URI/,
	);
	assert.throws(() => component({ name: "B", meta: { [CANVAS]: 3 } }), /must be an object/);
	assert.throws(() => component({ name: "C", meta: [] }), /meta must be an object/);
});

test("without a schema metaOf gives what the component says", () => {
	const scope = new Scope(() => {});
	const { Card: make } = scope.register({ Card });
	assert.deepEqual(metaOf(make(), CANVAS), { title: "Card", width: 320 });
	assert.deepEqual(metaOf(Card, "urn:example:none"), {});
});

test("with a schema metaOf fills its defaults, for components that say nothing too", () => {
	const scope = new Scope(() => {});
	scope.registerMetaSchemas({ [CANVAS]: shape });
	const { Card: make, Bare } = scope.register({ Card, Bare: component({ name: "Bare" }) });
	assert.deepEqual(metaOf(make(), CANVAS), { title: "Card", width: 320, transparent: false });
	assert.deepEqual(metaOf(Bare(), CANVAS), { title: null, width: null, transparent: false });
	assert.deepEqual(metaOf(Card, CANVAS, scope), { title: "Card", width: 320, transparent: false });
	assert.deepEqual(metaOf(Card, OTHER, scope), { anything: [1, 2] }, "other namespaces unchecked");
});

test("a component whose meta breaks a schema can't be registered", () => {
	const scope = new Scope(() => {});
	scope.registerMetaSchemas({ [CANVAS]: shape });
	const Bad = component({ name: "Bad", meta: { [CANVAS]: { width: -1, color: "red" } } });
	assert.throws(
		() => scope.register({ Bad }),
		/meta https:\/\/example.com\/meta\/canvas has no key color.*width isn't/,
	);
	const required = new Scope(() => {});
	required.registerMetaSchemas({ [OTHER]: { needed: t.string().len(1) } });
	assert.throws(() => required.register({ Card }), /lacks needed, which has no default/);
});

test("schemas are resolved in the component's scope, and checked as it's made when later", () => {
	const root = new Scope(() => {});
	const inner = root.enter("inner");
	const Wide = component({ name: "Wide", meta: { [CANVAS]: { width: 9000 } } });
	const { Wide: make } = inner.register({ Wide });
	root.registerMetaSchemas({ [CANVAS]: { width: t.number().max(4000) } });
	assert.throws(() => make(), /width isn't/);
	assert.throws(() => root.registerMetaSchemas({ canvas: shape }), /needs URIs/);
	assert.throws(() => root.registerMetaSchemas({ [CANVAS]: { width: 3 } }), /needs URIs/);
});
