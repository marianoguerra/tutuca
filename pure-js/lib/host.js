// A host: everything a program may name besides its own parameters and consts. Its declaration
// is plain data, TypeScript signatures as strings, so it can be checked against, sent and
// stored without the implementations; the implementations come by qualified name.
//
//   new Host({
//     types: { Todo: "{ title: string; done: boolean }" },          // records, by name
//     handles: { Ctx: "{ readonly key: string; notify(name: string): void }" }, // opaque objects
//     modules: { Math: { max: "(...values: number[]) => number" } }, // namespaces
//     functions: { String: "(value: number) => string" },           // names called as is
//     nondeterministic: ["Ctx.uuid"],     // results that depend on more than the arguments
//     fresh: ["Object.fromEntries"],      // results the program may change
//     imports: { "app/view": "View" },    // what a module imports from a specifier: a module's members
//   }, { "Math.max": Math.max, String })  // implementations, by qualified name
//
// A member may have overloads: an array of signatures. A name may be both a module and a
// function (Number is called and has members).

import { hostDeclarations, libDeclarations } from "./declarations.js";
import { typeOf } from "./parse.js";
import * as T from "./types.js";

// Declarations are parsed when first used, so a host of many types costs what a program
// reaches of it; a bad one says so then (and declarations() reaches them all).
const asNodes = (decl, what) => {
	const list = Array.isArray(decl) ? decl : [decl];
	return list.map((d) => (typeof d === "string" ? typeOf(d, what) : d));
};
const lazyNodes = (entry, src, what) => {
	let nodes = null;
	Object.defineProperty(entry, "nodes", { get: () => (nodes ??= asNodes(src, what)) });
	return entry;
};
const nameRe = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class Host {
	constructor(declaration = {}, implementations = {}) {
		const d = {
			types: { ...(declaration.types ?? {}) },
			handles: { ...(declaration.handles ?? {}) },
			modules: { ...(declaration.modules ?? {}) },
			functions: { ...(declaration.functions ?? {}) },
			nondeterministic: [...(declaration.nondeterministic ?? [])],
			fresh: [...(declaration.fresh ?? [])],
			imports: { ...(declaration.imports ?? {}) },
		};
		this.declaration = d;
		this.implementations = Object.freeze({ ...implementations });
		this.named = new Map(); // name -> { kind: "record" | "handle", node, ty }
		for (const [name, src] of Object.entries(d.types)) this.addNamed(name, "record", src);
		for (const [name, src] of Object.entries(d.handles)) this.addNamed(name, "handle", src);
		this.modules = new Map(); // name -> Map(member -> { qualified, ty })
		for (const [name, membersDecl] of Object.entries(d.modules)) {
			this.checkName(name, "module");
			const ms = new Map();
			for (const [m, src] of Object.entries(membersDecl)) {
				ms.set(m, lazyNodes({ qualified: `${name}.${m}`, ty: null }, src, `${name}.${m}`));
			}
			this.modules.set(name, ms);
		}
		this.functions = new Map(); // name -> { qualified, nodes, ty }
		for (const [name, src] of Object.entries(d.functions)) {
			this.checkName(name, "function");
			this.functions.set(name, lazyNodes({ qualified: name, ty: null }, src, name));
		}
		this.nondeterministic = new Set(d.nondeterministic);
		this.fresh = new Set(d.fresh);
		for (const [spec, m] of Object.entries(d.imports))
			if (!this.modules.has(m))
				throw new Error(
					`the host's import ${JSON.stringify(spec)} names ${m}, which isn't one of its modules`,
				);
		this.imports = new Map(Object.entries(d.imports)); // specifier -> module name
	}
	checkName(name, what) {
		if (!nameRe.test(name) || name.startsWith("$"))
			throw new Error(`a host ${what} needs a plain name, not ${JSON.stringify(name)}`);
	}
	addNamed(name, kind, src) {
		this.checkName(name, kind === "record" ? "type" : "handle");
		if (this.named.has(name)) throw new Error(`the host declares ${name} twice`);
		const entry = lazyNodes({ kind, ty: null }, src, name);
		Object.defineProperty(entry, "node", { get: () => entry.nodes[0] });
		this.named.set(name, entry);
	}
	// A host that also has what more declares (and implements); more wins where both have it.
	extend(more = {}, implementations = {}) {
		const d = this.declaration;
		const modules = { ...d.modules };
		for (const [name, ms] of Object.entries(more.modules ?? {}))
			modules[name] = { ...(modules[name] ?? {}), ...ms };
		return new Host(
			{
				types: { ...d.types, ...(more.types ?? {}) },
				handles: { ...d.handles, ...(more.handles ?? {}) },
				modules,
				functions: { ...d.functions, ...(more.functions ?? {}) },
				nondeterministic: [...d.nondeterministic, ...(more.nondeterministic ?? [])],
				fresh: [...d.fresh, ...(more.fresh ?? [])],
				imports: { ...d.imports, ...(more.imports ?? {}) },
			},
			{ ...this.implementations, ...implementations },
		);
	}
	// The declaration as plain JSON, every type as TypeScript text.
	describe() {
		return JSON.parse(JSON.stringify(this.declaration));
	}

	// The host as TypeScript declarations; with lib, the built-ins too, for tsc's noLib.
	declarations({ lib = true } = {}) {
		return `${lib ? libDeclarations() : ""}${hostDeclarations(this)}`;
	}

	// Types from declarations. onError(node, message) reports a problem; without it, it throws.
	toType(node, tvars = new Set(), onError = null) {
		const fail = (n, message) => {
			if (onError === null) throw new Error(message);
			onError(n, message);
			return T.UNKNOWN;
		};
		const to = (n) => this.toType(n, tvars, onError);
		switch (n_type(node)) {
			case "TypeKeyword": {
				const p = T.primitive(node.name);
				return p ?? fail(node, `pure-js has no type ${node.name}`);
			}
			case "TypeLiteral":
				return T.lit(node.value);
			case "TypeArray":
				return T.list(to(node.element));
			case "TypeTuple":
				return T.tuple(node.elements.map(to));
			case "TypeUnion":
				return T.union(node.types.map(to));
			case "TypeReadonly":
				return to(node.operand);
			case "TypeRef":
				if (tvars.has(node.name)) return T.tvar(node.name);
				// Readonly<T> is T: what may change is decided where a value is bound.
				if (node.name === "Readonly" && node.args.length === 1 && !this.named.has("Readonly"))
					return to(node.args[0]);
				if (this.named.has(node.name)) return T.ref(node.name);
				return fail(node, `there is no type ${node.name}`);
			case "TypeFunction":
				return T.fn([this.toSig(node, tvars, onError)]);
			case "TypeObject": {
				const index = node.members.filter((m) => m.type === "TypeIndex");
				if (index.length > 0) {
					if (node.members.length > 1)
						return fail(node, "a type is a record or a dictionary, not both");
					return T.dict(to(index[0].value));
				}
				const fields = {};
				const methods = {};
				for (const m of node.members) {
					if (m.type === "TypeMethod") {
						if (methods[m.name] === undefined) methods[m.name] = [];
						methods[m.name].push(this.toSig(m, tvars, onError));
					} else {
						fields[m.name] = { type: to(m.value), optional: m.optional, readonly: m.readonly };
					}
				}
				return T.record(null, fields, methods);
			}
			default:
				return fail(node, "not a type");
		}
	}
	toSig(node, tvars, onError) {
		const vars = new Set([...tvars, ...node.typeParams]);
		const params = node.params.map((p) => ({
			name: p.name,
			type: this.toType(p.value, vars, onError),
			optional: p.optional,
			rest: p.rest,
		}));
		return T.sig(params, this.toType(node.result, vars, onError), node.typeParams);
	}
	// What a named type is: a record (with mut from the ref), a handle, or what it aliases.
	resolve(r) {
		const entry = this.named.get(r.name);
		if (entry === undefined) return T.UNKNOWN;
		if (entry.ty === null) {
			const ty = this.toType(entry.node);
			if (entry.kind === "handle") {
				if (ty.k !== "record") throw new Error(`handle ${r.name} must be an object type`);
				entry.ty = T.handle(r.name, ty.fields, ty.methods);
			} else if (ty.k === "record") {
				entry.ty = { ...ty, name: r.name };
			} else {
				entry.ty = ty; // an alias of another type
			}
		}
		return entry.ty.k === "handle" ? entry.ty : T.withMut(entry.ty, r.mut);
	}
	// What a program's free name is in this host: a module, a function, or null.
	binding(name) {
		const m = this.modules.get(name);
		const f = this.functions.get(name);
		if (m === undefined && f === undefined) return null;
		return {
			kind: m !== undefined ? "module" : "function",
			name,
			call: f === undefined ? null : this.memberType(f),
		};
	}
	member(moduleName, name) {
		const m = this.modules.get(moduleName)?.get(name);
		if (m === undefined) return null;
		return { qualified: m.qualified, ty: this.memberType(m) };
	}
	memberType(entry) {
		if (entry.ty === null) {
			const tys = entry.nodes.map((n) => this.toType(n));
			entry.ty = tys.every((t) => t.k === "fn") ? T.fn(tys.flatMap((t) => t.sigs)) : tys[0];
		}
		return entry.ty;
	}
	names() {
		return [...new Set([...this.modules.keys(), ...this.functions.keys()])];
	}
	// The value a program's free name has when it runs: a frozen object without a prototype
	// for a module (a function without one when it is also called), the implementation for a
	// function.
	value(name) {
		const impl = (q) => {
			if (!Object.hasOwn(this.implementations, q))
				throw new Error(`the host has no implementation of ${q}`);
			return this.implementations[q];
		};
		const ms = this.modules.get(name);
		const f = this.functions.get(name);
		if (ms === undefined) return impl(f.qualified);
		let target;
		if (f !== undefined) {
			const call = impl(f.qualified);
			target = (...args) => call(...args);
		} else target = {};
		Object.setPrototypeOf(target, null);
		for (const [m, entry] of ms) {
			const value = impl(entry.qualified);
			Object.defineProperty(target, m, {
				value,
				enumerable: true,
				writable: false,
				configurable: false,
			});
		}
		return Object.freeze(target);
	}
}
const n_type = (node) => node?.type ?? null;

// Entry signatures: what a program's this and parameters are. read: the program sees it and
// can't change it; draft: the program may change it, all the way down.
export const read = (type) => ({ mode: "read", type });
export const draft = (type) => ({ mode: "draft", type });
