// Component specs: component() turns options into a ComponentSpec that makes instances.
import { immerable } from "../deps/immer.js";
import { NoDefaultError, scopeSym, specSym, t, toMessages } from "./schema.js";
import { toExpr } from "./view.js";
import { Collect } from "./walk.js";

export class ComponentSpec {
	constructor({ name, fields, methods, views, on, loops, scopes, provides, invariants }) {
		this.name = name;
		this.fields = fields;
		this.methods = methods;
		// Copy descriptors, not values, so getters in methods stay getters.
		this.proto = Object.create(null, Object.getOwnPropertyDescriptors(methods));
		Object.assign(this.proto, { [immerable]: true, [specSym]: this });
		this.views = views;
		this.on = on;
		this.loops = loops;
		this.scopes = scopes;
		this.provides = provides;
		this.invariants = invariants; // name → predicate on the instance, checked in dev and tests.
		const collect = new Collect();
		for (const key in views) views[key].walk(collect);
		this.eventHandlers = collect.eventHandlers;
		this.eventNames = new Set([...this.eventHandlers.values()].flat().map((h) => h.name));
	}
	make(args = {}, scope = null) {
		const state = Object.create(this.proto);
		if (scope !== null) state[scopeSym] = scope;
		for (const key in this.fields) {
			try {
				state[key] = this.fields[key].make(args[key], scope, state);
			} catch (error) {
				// Prefix the field, so nested failures read as a path: Root.child: Child.item: ...
				const Wrapped = error instanceof NoDefaultError ? NoDefaultError : Error;
				throw new Wrapped(`${this.name}.${key}: ${error.message}`, { cause: error });
			}
		}
		return state;
	}
}
const ownEntries = (record) => Object.assign(Object.create(null), record); // no toString &c in entries
export const component = (opts) => {
	const { name, fields = {}, methods = {}, view, views = {} } = opts;
	const schema = typeof fields === "function" ? fields(t) : fields;
	const sources = view === undefined ? views : { ...views, main: view };
	const exprs = ownEntries({});
	for (const key in sources) exprs[key] = toExpr(sources[key]);
	if (!("main" in exprs)) throw new Error(`Component ${name} has no main view`);
	return new ComponentSpec({
		name,
		fields: schema,
		methods,
		views: exprs,
		on: toMessages(opts.on),
		loops: ownEntries(opts.loops),
		scopes: ownEntries(opts.scopes),
		provides: ownEntries(opts.provides),
		invariants: ownEntries(opts.invariants),
	});
};
