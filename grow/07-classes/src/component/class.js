// Classes (spec/component/class.rkt): the model half of component(). A class says what state
// its instances hold.
//
// Instances are values: plain frozen objects whose prototype says which class they are of.
import { makeField } from "./types.js";

const classSym = Symbol("class");
// comp-class: the class of an instance, undefined for any other value.
export const classOf = (value) => value?.[classSym];
export const isComponent = (value) => classOf(value) !== undefined;

export class ClassDef {
	constructor({ name, fields }) {
		this.name = name;
		this.fields = fields;
		// No Object.prototype behind it: an instance has its fields and nothing else.
		this.proto = Object.create(null);
		this.proto[classSym] = this;
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

export const component = ({ name, fields = {} }) => new ClassDef({ name, fields });
