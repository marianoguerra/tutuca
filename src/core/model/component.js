// Component specs: component() turns options into a ComponentSpec that makes instances.
import { immerable } from "../../../deps/immer.js";
import { mint } from "../../tree/index.js";
import { toNode, ViewNode } from "../view/view.js";
import { eventHandlersOf } from "../view/walk.js";
import { toMeta } from "./component-meta.js";
import { QuerySpec, scopeSym, specSym, toAnswers, toMessages, toQueries } from "./spec.js";
import { enabledTarget, enabledTargetNames } from "./targets.js";
import { prefixed } from "./types.js";

export class ComponentSpec {
	constructor({
		name,
		fields,
		methods,
		views,
		renders,
		on,
		answers,
		loops,
		binds,
		provides,
		invariants,
		queries,
		implements: implemented,
		meta,
	}) {
		this.name = name;
		/** @type {Object<string, import("./types.js").Type>} */
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
		// What it says about itself to hosts, by namespace URI (component-meta.js's toMeta), frozen.
		this.meta = meta;
		/** @type {Object<string, import("../view/view.js").ViewNode>} */
		this.views = views;
		// What it renders other than a page, by enabled target name (targets.js), each its views
		// by name.
		/** @type {Object<string, Object<string, import("../view/view.js").ViewNode>>} */
		this.renders = renders;
		this.on = on;
		this.answers = answers; // ask name -> outcome (ok, error, unhandled) -> its handler.
		this.loops = loops;
		this.binds = binds; // name -> fn returning the names withBinds(name, ...) puts in scope.
		this.provides = provides;
		this.invariants = invariants; // name → predicate on the instance, checked in dev and tests.
		this.eventHandlers = new Map(
			[views, ...Object.values(renders)].flatMap((byName) => [...eventHandlersOf(byName)]),
		);
		this.eventTypes = new Set([...this.eventHandlers.values()].flat().map((h) => h.type));
	}
	// Its views for a RenderTarget, the page's for null; undefined when it renders nothing for it.
	viewsFor(target) {
		return target === null ? this.views : this.renders[target.name];
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
// view and views as nodes by name, view as main.
const viewsOf = (view, views) => {
	const sources = view === undefined ? views : { ...views, main: view };
	const exprs = ownEntries({});
	for (const key in sources) exprs[key] = toNode(sources[key]);
	return exprs;
};
// A target's render is one tree, its main view, or a plain object of views by name with a main.
const isViewsObject = (v) => {
	if (v === null || typeof v !== "object" || v instanceof ViewNode) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};
const rendersOf = (name, renders) => {
	const out = ownEntries({});
	for (const target in renders) {
		if (enabledTarget(target) === null) {
			const names = enabledTargetNames();
			throw new Error(
				`Component ${name} renders ${target}, which isn't an enabled render target: pass its ` +
					`target to enableTargets first (${names.length === 0 ? "none is enabled" : `enabled: ${names.join(", ")}`})`,
			);
		}
		const source = renders[target];
		const exprs = isViewsObject(source) ? viewsOf(undefined, source) : viewsOf(source, {});
		if (!("main" in exprs))
			throw new Error(`Component ${name} renders ${target} views but no main one`);
		out[target] = exprs;
	}
	return out;
};
export const component = (opts) => {
	const { name, fields = {}, methods = {}, view, views = {}, renders = {} } = opts;
	const exprs = viewsOf(view, views);
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
		renders: rendersOf(name, renders),
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
