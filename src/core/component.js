// Component specs: component() turns options into a ComponentSpec that makes instances. This is
// where the model (fields, messages, queries: model/) and the views (view/) of a component meet;
// neither imports the other's directory.
import { immerable, produce } from "../../deps/immer.js";
import { mint } from "../tree/index.js";
import { toMeta } from "./model/component-meta.js";
import { QuerySpec, scopeSym, specSym, toAnswers, toMessages, toQueries } from "./model/spec.js";
import { compileShape, compileType, prefixed } from "./model/types.js";
import { enabledTarget, enabledTargetNames } from "./view/targets.js";
import { toNode, ViewNode } from "./view/view.js";
import { eventBindingsOf } from "./view/walk.js";

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
		checks,
		definition,
		init,
	}) {
		this.name = name;
		// init(next, ctx): what finishes an instance made from its fields (make), on a draft of it,
		// this the instance as its fields made it; ctx makes components in its scope.
		this.init = init;
		// The options component() made it from, data and code as given: what a component made
		// from this one spreads (component({ ...Base.definition, name: "Other" })).
		this.definition = definition;
		// The named checks its types use (types.js): name -> a function or { test, arb, description }.
		this.checks = checks;
		/** @type {Object<string, import("./model/types.js").Type>} */
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
		// The interfaces it says it implements, by name, resolved in the scope it is registered in
		// (scope.js checks them there).
		this.implements = implemented;
		// What it says about itself to hosts, by namespace URI (component-meta.js's toMeta), frozen.
		this.meta = meta;
		/** @type {Object<string, import("./view/view.js").ViewNode>} */
		this.views = views;
		// What it renders other than a page, by enabled target name (targets.js), each its views
		// by name.
		/** @type {Object<string, Object<string, import("./view/view.js").ViewNode>>} */
		this.renders = renders;
		this.on = on;
		this.answers = answers; // ask name -> outcome (ok, error, unhandled) -> its handler.
		this.loops = loops;
		this.binds = binds; // name -> fn returning the names withBinds(name, ...) puts in scope.
		this.provides = provides;
		this.invariants = invariants; // name → predicate on the instance, checked in dev and tests.
		this.eventBindings = new Map(
			[views, ...Object.values(renders)].flatMap((byName) => [...eventBindingsOf(byName)]),
		);
		this.eventTypes = new Set([...this.eventBindings.values()].flat().map((h) => h.type));
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
		if (typeof this.init !== "function") return state;
		const ctx = new InitContext(this.name, scope);
		try {
			return produce(state, (draft) => {
				this.init.call(state, draft, ctx);
			});
		} catch (error) {
			throw prefixed(`${this.name}.init`, error);
		}
	}
}
// What an init reads: it makes the components its instance holds, in the scope it's made in.
export class InitContext {
	constructor(name, scope) {
		this.name = name;
		this.scope = scope;
	}
	make(name, fields = {}) {
		if (this.scope === null)
			throw new Error(`ctx.make(${name}): ${this.name} is made with no scope`);
		return this.scope.make(name, fields);
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
// A component's types are data (types.js), compiled here with its checks; a type that isn't
// one, or names a check it doesn't have, throws as the component is made.
// implements names interfaces, resolved where the component is registered.
const implementsOf = (name, implemented) => {
	const names = [implemented ?? []].flat();
	for (const it of names) {
		if (typeof it !== "string")
			throw new TypeError(`Component ${name}: implements names interfaces, not ${String(it)}`);
	}
	return names;
};
export const component = (opts) => {
	const { name, methods = {}, view, views = {}, renders = {} } = opts;
	const checks = ownEntries(opts.checks);
	// The compileType of its types under a section (on., answers., queries.), and how it
	// fails there.
	const typesIn = (section) => {
		const type = (data, at) => {
			try {
				return compileType(data, checks);
			} catch (error) {
				throw new TypeError(`Component ${name}: ${section}${at}: ${error.message}`, {
					cause: error,
				});
			}
		};
		type.fail = (message) => {
			throw new TypeError(`Component ${name}: ${section}${message}`);
		};
		return type;
	};
	let fields;
	try {
		fields = compileShape(opts.fields ?? {}, checks);
	} catch (error) {
		throw new TypeError(`Component ${name}: ${error.message}`, { cause: error });
	}
	const exprs = viewsOf(view, views);
	// A component with no views at all only handles messages (headless) and renders nothing;
	// one with views needs a main one.
	if (view === undefined && Object.keys(views).length === 0) exprs.main = toNode("");
	if (!("main" in exprs)) throw new Error(`Component ${name} has no main view`);
	const queries = toQueries(opts.queries, fields, typesIn(""));
	collisions(name, fields, queries, methods);
	return new ComponentSpec({
		name,
		fields,
		methods,
		views: exprs,
		renders: rendersOf(name, renders),
		on: toMessages(opts.on, typesIn("on.")),
		answers: toAnswers(opts.answers, typesIn("answers.")),
		loops: ownEntries(opts.loops),
		binds: ownEntries(opts.binds),
		provides: ownEntries(opts.provides),
		invariants: ownEntries(opts.invariants),
		queries,
		implements: implementsOf(name, opts.implements),
		meta: toMeta(name, opts.meta),
		checks,
		definition: Object.freeze({ ...opts }),
		init: opts.init,
	});
};
