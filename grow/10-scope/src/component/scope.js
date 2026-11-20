// Scopes: the names classes are registered under, and the factories that make their instances.
//
// A type names a class, t.component("Item"), without holding it, so a class can hold instances
// of itself and two classes can hold each other. The scope is what turns the name into the class.
// Scopes nest: a name is looked up here, then in the scopes above.
export class Scope {
	constructor(parent = null) {
		this.parent = parent;
		this.classes = Object.create(null);
		// scope.components.Item(args) makes an Item here.
		this.components = new Proxy(Object.create(null), {
			get: (_target, name) => (args) => this.make(name, args),
		});
	}
	// A scope below this one: what is registered there is not seen from here.
	enter() {
		return new Scope(this);
	}
	// Registers classes by name and returns their factories, { Name: (args) => instance }.
	register(classes) {
		const factories = {};
		for (const [name, classDef] of Object.entries(classes)) {
			this.classes[name] = classDef;
			factories[name] = this.components[name];
		}
		return factories;
	}
	lookupClass(name) {
		for (let scope = this; scope !== null; scope = scope.parent) {
			if (scope.classes[name] !== undefined) return scope.classes[name];
		}
		return null;
	}
	make(name, args) {
		const classDef = this.lookupClass(name);
		if (classDef === null) throw new Error(`Component ${String(name)} is not registered`);
		return classDef.make(args, this);
	}
}
