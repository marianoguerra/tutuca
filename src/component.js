// Component specs: component() turns options into a ComponentSpec that makes instances.
import { immerable } from "../deps/immer.js";
import { toMeta } from "./component-meta.js";
import { DRAG_EVENTS } from "./drag.js";
import { prefixed } from "./schema.js";
import { QuerySpec, scopeSym, specSym, toAnswers, toMessages, toQueries } from "./spec.js";
import { mint } from "./tree/identity.js";
import { toNode } from "./view.js";
import { eventHandlersOf } from "./walk.js";

export class ComponentSpec {
	constructor({
		name,
		fields,
		methods,
		views,
		on,
		answers,
		loops,
		binds,
		provides,
		invariants,
		queries = Object.create(null),
		implements: implemented = [],
		meta = toMeta(name, undefined),
	}) {
		this.name = name;
		/** @type {Object<string, import("./schema.js").Type>} */
		this.fields = fields;
		this.methods = methods;
		// Copy descriptors, not values, so getters in methods stay getters.
		this.proto = Object.create(null, Object.getOwnPropertyDescriptors(methods));
		Object.assign(this.proto, { [immerable]: true, [specSym]: this });
		// Queries live on the prototype too, so handlers and views read them as this.name.
		this.queries = queries; // name -> QuerySpec: the public reads, public fields among them.
		for (const qname in queries) {
			const q = queries[qname];
			if (!(q instanceof QuerySpec) || q.kind === "field") continue;
			const descriptor = q.kind === "get" ? { get: q.fn } : { value: q.fn, writable: true };
			Object.defineProperty(this.proto, qname, { ...descriptor, configurable: true });
		}
		// The interfaces it says it implements: Interfaces, or names resolved in the scope it is
		// registered in (scope.js checks them there).
		this.implements = implemented;
		// What it says about itself to hosts, by namespace URI (spec.js's toMeta), frozen.
		this.meta = meta;
		/** @type {Object<string, import("./view.js").AstNode>} */
		this.views = views;
		this.on = on;
		this.answers = answers; // ask name -> outcome (ok, error, unhandled) -> its handler.
		this.loops = loops;
		this.binds = binds; // name -> fn returning the names withBinds(name, ...) puts in scope.
		this.provides = provides;
		this.invariants = invariants; // name → predicate on the instance, checked in dev and tests.
		this.eventHandlers = eventHandlersOf(views);
		this.eventNames = new Set([...this.eventHandlers.values()].flat().map((h) => h.name));
		// A drop target needs the drag from its start: the host tracks it.
		if (this.eventNames.has("drop")) for (const name of DRAG_EVENTS) this.eventNames.add(name);
	}
	make(args = {}, scope = null) {
		const state = mint(Object.create(this.proto));
		if (scope !== null) state[scopeSym] = scope;
		for (const key in this.fields) {
			try {
				state[key] = this.fields[key].make(args[key], scope, state);
			} catch (error) {
				throw prefixed(`${this.name}.${key}`, error);
			}
		}
		return state;
	}
}
const ownEntries = (record) => Object.assign(Object.create(null), record); // no toString &c in entries
// A name is one thing: a field (a public one is also its query), a query, a method or a message.
const collisions = (name, fields, queries, methods) => {
	const found = [];
	for (const q in queries) {
		if (queries[q] instanceof QuerySpec && queries[q].kind === "field") continue;
		if (q in fields) found.push(`query ${q} is also a field`);
		if (Object.hasOwn(methods, q)) found.push(`query ${q} is also a method`);
	}
	for (const m of Object.keys(methods)) {
		if (m in fields) found.push(`method ${m} is also a field`);
	}
	if (found.length > 0) throw new Error(`Component ${name}: ${found.join(", ")}`);
};
export const component = (opts) => {
	const { name, fields = {}, methods = {}, view, views = {} } = opts;
	const sources = view === undefined ? views : { ...views, main: view };
	const exprs = ownEntries({});
	for (const key in sources) exprs[key] = toNode(sources[key]);
	// A component with no views at all only handles messages (headless) and renders nothing;
	// one with views needs a main one.
	if (view === undefined && Object.keys(views).length === 0) exprs.main = toNode("");
	if (!("main" in exprs)) throw new Error(`Component ${name} has no main view`);
	const queries = toQueries(opts.queries, fields);
	collisions(name, fields, queries, methods);
	return new ComponentSpec({
		name,
		fields,
		methods,
		views: exprs,
		on: toMessages(opts.on),
		answers: toAnswers(opts.answers),
		loops: ownEntries(opts.loops),
		binds: ownEntries(opts.binds),
		provides: ownEntries(opts.provides),
		invariants: ownEntries(opts.invariants),
		queries,
		implements: [opts.implements ?? []].flat(),
		meta: toMeta(name, opts.meta),
	});
};
