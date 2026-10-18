// Scopes: the names components are registered under, nested into a tree, and the factories
// that make components through them.
// A component ref is its scope's path and its name there: "Item" at the root, "editor/Item" below.
const refSep = "/";
export class Scope {
	constructor(onRegister, parent = null, name = null) {
		this.onRegister = onRegister;
		this.parent = parent;
		this.name = name;
		this.path = parent === null ? [] : [...parent.path, name];
		this.children = Object.create(null);
		this.byName = Object.create(null);
		this.askHandlers = Object.create(null);
		this.components = new Proxy(Object.create(null), {
			get: (_target, name) => this.factory(name),
		});
	}
	// Names make scopes a namespace tree, so a component's ref finds the same scope on reload.
	enter(name) {
		if (typeof name !== "string" || name === "" || name.includes(refSep)) {
			throw new Error(`scope.enter needs a name without "${refSep}", got ${String(name)}`);
		}
		this.children[name] ??= new Scope(this.onRegister, this, name);
		return this.children[name];
	}
	// The ref of a component made in this scope: this path and a name it's looked up by here.
	refFor(spec) {
		for (let s = this; s !== null; s = s.parent) {
			for (const name in s.byName) {
				if (s.byName[name] === spec && this.lookupByName(name) === spec) {
					return [...this.path, name].join(refSep);
				}
			}
		}
		throw new Error(`Component ${spec.name} is not registered in scope /${this.path.join(refSep)}`);
	}
	// The scope and name a ref names, from this scope down.
	resolveRef(ref) {
		const keys = ref.split(refSep);
		const name = keys.pop();
		let scope = this;
		for (const key of keys) {
			scope = scope.children[key];
			if (scope === undefined) throw new Error(`No scope ${keys.join(refSep)} for ${ref}`);
		}
		return { scope, name };
	}
	register(comps) {
		const factories = {};
		for (const name in comps) {
			const spec = comps[name];
			this.byName[name] = spec;
			this.onRegister(spec, name);
			factories[name] = this.factory(name);
		}
		return factories;
	}
	factory(name) {
		return (args) => this.make(name, args);
	}
	lookup(getter) {
		let scope = this;
		while (scope !== null) {
			const v = getter(scope);
			if (v !== undefined) return v;
			scope = scope.parent;
		}
		return null;
	}
	registerAskHandlers(handlers) {
		Object.assign(this.askHandlers, handlers);
	}
	lookupAskHandler(name) {
		return this.lookup((scope) => scope.askHandlers[name]);
	}
	lookupByName(name) {
		return this.lookup((scope) => scope.byName[name]);
	}
	// Every spec registered here or in a parent, by name; inner registrations win.
	allSpecs() {
		const specs = {};
		for (let s = this; s !== null; s = s.parent) {
			for (const name in s.byName) specs[name] ??= s.byName[name];
		}
		return specs;
	}
	make(name, args) {
		const spec = this.lookupByName(name);
		if (spec === null) throw new Error(`Component ${String(name)} is not registered`);
		return spec.make(args, this);
	}
}
