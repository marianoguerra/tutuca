// Classes (spec/component/class.rkt): the model half of component(). A class says what state
// its instances hold and which messages they handle. It also keeps the views that render them,
// which are the view layer's to read (src/view/view.js).
//
// Instances are values: plain frozen objects whose prototype says which class they are of.
import { immerable } from "../../../../deps/immer.js";
import { classOf, classSym, isComponent, scopeSym } from "./instance.js";
import { makeField } from "./types.js";

export { classOf, isComponent };

// A message's handler with its contract: the types of the arguments, a precondition on self and
// the arguments, pre(self, args), and a postcondition relating self and next,
// post(self, next, args). All are called with self as this, as run(next, args) is.
// A pure one only steps its instance, so it can be applied to one directly (contract.js).
export class Handler {
	constructor(name, entry) {
		const { run, args, pre, post, pure } = typeof entry === "function" ? { run: entry } : entry;
		this.pure = pure === true;
		this.name = name;
		this.run = run;
		this.args = args;
		this.pre = pre;
		this.post = post;
	}
}

// A query: a read of an instance, with no effects. A get one reads like a field, a call one
// takes arguments. args and returns type them.
export class Query {
	constructor(name, { kind, fn, args = [], returns }) {
		this.name = name;
		this.kind = kind; // "get" or "call"
		this.fn = fn;
		this.args = args;
		this.returns = returns;
	}
}
// queries' entries: a getter, a function, { get, returns } or { run, args, returns }.
function toQueries(queries) {
	const out = {};
	for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(queries))) {
		if (d.get !== undefined) out[name] = new Query(name, { kind: "get", fn: d.get });
		else if (typeof d.value === "function")
			out[name] = new Query(name, { kind: "call", fn: d.value });
		else if (typeof d.value.get === "function")
			out[name] = new Query(name, { kind: "get", fn: d.value.get, returns: d.value.returns });
		else out[name] = new Query(name, { kind: "call", fn: d.value.run, ...d.value });
	}
	return out;
}

const mapValues = (record, fn) =>
	Object.fromEntries(Object.entries(record).map(([key, v]) => [key, fn(key, v)]));

export class ClassDef {
	constructor({ name, fields, invariants, on, queries, implements: implemented, views }) {
		// name -> view expression. main is the one a render uses.
		this.views = views;
		this.name = name;
		this.fields = fields;
		// name -> predicate, called with the instance as this.
		this.invariants = invariants;
		// name -> Handler. An entry is the handler's function, or { run, args, pre, post }.
		this.on = mapValues(on, (key, entry) => new Handler(key, entry));
		// No Object.prototype behind it: an instance has its fields and nothing else.
		this.proto = Object.create(null);
		this.proto[classSym] = this;
		this.proto[immerable] = true; // A handler writes on a draft of the instance.
		// name -> Query. They are on the prototype too, so handlers and other queries read them
		// as this.name.
		this.queries = toQueries(queries);
		for (const q of Object.values(this.queries)) {
			Object.defineProperty(this.proto, q.name, q.kind === "get" ? { get: q.fn } : { value: q.fn });
		}
		// The interfaces it says it implements: Interfaces, or their names in the scope it is
		// registered in.
		this.implements = implemented;
	}
	// An instance from arguments by field name. Each field is made in the order the class
	// declares it, and its owner is the instance so far, so a field can read the ones before it.
	// scope is the Scope making it, which makes the components its fields default to.
	make(args = {}, scope = null) {
		const self = Object.create(this.proto);
		if (scope !== null) self[scopeSym] = scope;
		for (const [fname, ty] of Object.entries(this.fields)) {
			try {
				self[fname] = makeField(ty, args[fname], self);
			} catch (error) {
				error.message = `${this.name}.${fname}: ${error.message}`;
				throw error;
			}
		}
		return Object.freeze(self);
	}
}

// view is the main view; views are views by name. A class with views needs a main one; one
// with none only handles messages, and renders nothing.
function viewsOf(name, view, views) {
	const all = view === undefined ? { ...views } : { ...views, main: view };
	if (Object.keys(all).length === 0) all.main = null;
	if (!("main" in all)) throw new Error(`Component ${name} has no main view`);
	return all;
}

export const component = ({
	name,
	fields = {},
	invariants = {},
	on = {},
	queries = {},
	implements: implemented = [],
	view,
	views = {},
}) =>
	new ClassDef({
		name,
		fields,
		invariants,
		on,
		queries,
		implements: [implemented].flat(),
		views: viewsOf(name, view, views),
	});
