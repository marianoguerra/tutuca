// Classes (spec/component/class.rkt): the model half of component(). A class says what state
// its instances hold and which messages they handle.
//
// Instances are values: plain frozen objects whose prototype says which class they are of.
import { immerable } from "../../../../deps/immer.js";
import { makeField } from "./types.js";

const classSym = Symbol("class");
// comp-class: the class of an instance, undefined for any other value.
export const classOf = (value) => value?.[classSym];
export const isComponent = (value) => classOf(value) !== undefined;

// A message's handler with its contract: the types of the arguments, a precondition on self and
// the arguments, pre(self, args), and a postcondition relating self and next,
// post(self, next, args). All are called with self as this, as run(next, args) is.
export class Handler {
	constructor(name, entry) {
		const { run, args, pre, post } = typeof entry === "function" ? { run: entry } : entry;
		this.name = name;
		this.run = run;
		this.args = args;
		this.pre = pre;
		this.post = post;
	}
}

const mapValues = (record, fn) =>
	Object.fromEntries(Object.entries(record).map(([key, v]) => [key, fn(key, v)]));

export class ClassDef {
	constructor({ name, fields, invariants, on }) {
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
	}
	// An instance from arguments by field name. Each field is made in the order the class
	// declares it, and its owner is the instance so far, so a field can read the ones before it.
	make(args = {}) {
		const self = Object.create(this.proto);
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

export const component = ({ name, fields = {}, invariants = {}, on = {} }) =>
	new ClassDef({ name, fields, invariants, on });
