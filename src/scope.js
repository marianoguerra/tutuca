// Scopes: the names components and interfaces are registered under, nested into a tree, and
// the factories that make components through them.
import { Interface, interfaceProblems, resolveImplements } from "./spec.js";

// A component ref is its scope's path and its name there: "Item" at the root, "editor/Item" below.
const refSep = "/";
export class Scope {
	/** @param {Scope | null} parent */
	constructor(onRegister, parent = null, name = null) {
		this.onRegister = onRegister;
		this.parent = parent;
		this.name = name;
		this.path = parent === null ? [] : [...parent.path, name];
		this.children = Object.create(null);
		this.byName = Object.create(null);
		this.askHandlers = Object.create(null);
		this.interfaces = Object.create(null); // name -> Interface, looked up as components are.
		this.implementsChecked = new WeakSet(); // Specs whose interfaces hold here, for make.
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
	// This scope and its parents, nearest first.
	*ancestors() {
		for (let s = this; s !== null; s = s.parent) yield s;
	}
	// This scope and every one below it, parents first.
	*descendants() {
		yield this;
		for (const name in this.children) yield* this.children[name].descendants();
	}
	get root() {
		let s = this;
		while (s.parent !== null) s = s.parent;
		return s;
	}
	// The ref of a component made in this scope: this path and a name it's looked up by here.
	refFor(spec) {
		for (const s of this.ancestors()) {
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
			this.checkImplements(spec, name);
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
		for (const scope of this.ancestors()) {
			const v = getter(scope);
			if (v !== undefined) return v;
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
	// Interfaces by name, for components here and below to implement and fields to hold. One
	// registered after a component is checked as the component is made.
	registerInterfaces(ifaces) {
		for (const name in ifaces) {
			if (!(ifaces[name] instanceof Interface)) {
				throw new Error(
					`registerInterfaces needs Interfaces (iface()), got ${String(ifaces[name])} for ${name}`,
				);
			}
			this.interfaces[name] = ifaces[name];
		}
		// Here and below they may now resolve differently.
		for (const s of this.descendants()) s.implementsChecked = new WeakSet();
	}
	lookupInterface(name) {
		return this.lookup((scope) => scope.interfaces[name]);
	}
	// spec implements, resolved here, what it says it implements, and the interface name is
	// under here if it is registered (or made) by one. Throws saying what's missing.
	checkImplements(spec, name = null) {
		const problems = [];
		const resolved = resolveImplements(spec, this);
		(spec.implements ?? []).forEach((it, i) => {
			if (resolved[i] === null) problems.push(`it implements ${it}, which isn't an interface here`);
		});
		const ifaces = resolved.filter((it) => it !== null);
		const under = name === null ? null : this.lookupInterface(name);
		if (under !== null && !ifaces.includes(under)) ifaces.push(under);
		for (const it of ifaces) {
			for (const problem of interfaceProblems(spec, it)) problems.push(`${problem} (${it.name})`);
		}
		if (problems.length > 0) {
			const as = under === null ? "" : ` as ${name}`;
			throw new Error(
				`${spec.name} can't be registered${as} in scope /${this.path.join(refSep)}: ${problems.join("; ")}`,
			);
		}
		this.implementsChecked.add(spec);
	}
	// Every spec registered here or in a parent, by name; inner registrations win.
	allSpecs() {
		const specs = {};
		for (const s of this.ancestors()) {
			for (const name in s.byName) specs[name] ??= s.byName[name];
		}
		return specs;
	}
	// Every spec registered here or below, by its ref.
	specsByRef() {
		const specs = new Map();
		for (const s of this.descendants()) {
			for (const name in s.byName) specs.set([...s.path, name].join(refSep), s.byName[name]);
		}
		return specs;
	}
	make(name, args) {
		const spec = this.lookupByName(name);
		if (spec === null) throw new Error(`Component ${String(name)} is not registered`);
		if (!this.implementsChecked.has(spec)) this.checkImplements(spec, name);
		return spec.make(args, this);
	}
}
