// Modules: a program of declarations, the module profile's. A module declares types (aliases and
// interfaces), constants, helper functions and namespaces, and imports what other modules
// export and what the host offers by specifier. Functions are never values: a helper is called
// by name, a namespace's methods and getters are entries the embedder calls (with a signature
// it gives for each, by path), and neither is read or passed. The calls between functions are
// therefore known from the tree, and a module whose calls form a cycle is rejected, so every
// run still ends. Constants are made in the order they're written, as JavaScript makes them,
// and a constant that needs one written after it (directly or through the functions it calls)
// is rejected too.
//
//   const { diagnostics, entries, exports, types } = verifyModule(source, {
//     host, resolve, signatureOf: (path) => (path.join(".") === "Counter.on.add.run" ? sig : null),
//   });

import { itemDeclaration, walk } from "./ast.js";
import { Checker, Env, isReadonlyNode, Scope } from "./check.js";
import { Diagnostic } from "./diagnostic.js";
import { Host } from "./host.js";
import { parseModule } from "./parse.js";
import { sieve } from "./sieve.js";
import * as T from "./types.js";

const error = (code, node, message, help = null) =>
	new Diagnostic({ code, stage: "check", message, start: node.start, end: node.end, help });

// Whether an object literal holds methods or getters, itself or in the object literals it holds:
// a namespace.
export const isNamespaceLiteral = (e) =>
	e?.type === "ObjectExpression" &&
	e.properties.some(
		(p) => p.type === "Property" && (p.method || p.kind === "get" || isNamespaceLiteral(p.value)),
	);

// The entries of a namespace literal: { path, kind, node } for each method and getter.
export const entriesOf = (literal, prefix) => {
	const out = [];
	for (const p of literal.properties) {
		if (p.type !== "Property") continue;
		const name = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
		const path = [...prefix, name];
		if (p.method) out.push({ path, kind: "method", node: p.value, property: p });
		else if (p.kind === "get") out.push({ path, kind: "getter", node: p.value, property: p });
		else if (isNamespaceLiteral(p.value)) out.push(...entriesOf(p.value, path));
	}
	return out;
};

// The module's names an expression or function refers to, as the Identifier nodes that do.
const references = (node, names, skipEntries = false) => {
	const out = [];
	walk(node, (n, parent, key) => {
		if (skipEntries && n.type === "Property" && (n.method || n.kind === "get")) return false;
		if (n.type !== "Identifier") return;
		if (parent?.type === "MemberExpression" && key === "property" && !parent.computed) return;
		if (parent?.type === "Property" && key === "key" && !parent.computed) return;
		if (names.has(n.name)) out.push(n);
	});
	return out;
};

class ModuleChecker {
	constructor(
		module,
		{ host, resolve, signatureOf, dataTypeOf, deterministic, cache, visiting, specifier },
	) {
		this.dataTypeOf = dataTypeOf;
		this.module = module;
		this.src = module.source ?? "";
		this.baseHost = host;
		this.resolve = resolve;
		this.signatureOf = signatureOf;
		this.deterministic = deterministic;
		this.cache = cache;
		this.visiting = visiting;
		this.specifier = specifier;
		this.diagnostics = [];
		this.typeTable = new Map();
		this.typeNodes = {}; // name -> type node: this module's types and those it reaches
		this.exportedTypes = new Set();
		this.exported = new Set();
		this.imported = []; // { local, binding }
		this.consts = []; // { decl, id, init, index, exported }
		this.helpers = []; // { decl, name, exported }
		this.callGraph = {};
		this.summaries = {};
	}
	report(code, node, message, help = null) {
		this.diagnostics.push(error(code, node, message, help));
	}

	run() {
		this.collect();
		this.host = this.buildHost();
		this.scope = new Scope(null);
		for (const { local, binding } of this.imported) this.scope.names.set(local, binding);
		// Every const and helper is a name from the start, so a reference checks whatever order the
		// declarations come in; each gets its type as it's checked, in dependency order.
		for (const c of this.consts)
			this.scope.names.set(c.id.name, { kind: "const", type: T.NEVER, mode: "read", place: null });
		for (const h of this.helpers) this.scope.names.set(h.name, this.provisional(h));
		this.checker = this.makeChecker({
			type: "PureProgram",
			form: "function",
			function: null,
			source: this.src,
		});
		const order = this.order();
		for (const n of order) {
			if (n.kind === "const") this.checkConst(n.item);
			else this.checkHelper(n.item);
		}
		const entries = [];
		for (const c of this.consts) {
			if (!isNamespaceLiteral(c.init)) continue;
			for (const entry of entriesOf(c.init, [c.id.name])) entries.push(this.checkEntry(entry));
		}
		const values = new Map();
		for (const name of this.exported) values.set(name, this.scope.names.get(name));
		return {
			diagnostics: this.diagnostics,
			entries,
			exports: { types: this.exportedTypes, values },
			typeNodes: this.typeNodes,
			types: this.typeTable,
			callGraph: this.callGraph,
			summaries: this.summaries,
			host: this.host,
			scope: this.scope,
			module: this.module,
		};
	}

	// The module's items, by what they declare.
	collect() {
		this.localTypes = [];
		for (const item of this.module.items) {
			const d = itemDeclaration(item);
			const exported = item.type === "ExportNamedDeclaration";
			switch (d.type) {
				case "ImportDeclaration":
					this.importFrom(d);
					break;
				case "TypeAlias":
				case "InterfaceDeclaration":
					this.localTypes.push(d);
					if (exported) this.exportedTypes.add(d.id.name);
					break;
				case "VariableDeclaration":
					for (const x of d.declarations) {
						if (x.id.type !== "Identifier") {
							this.report(
								"module-pattern",
								x.id,
								"a module's const names one value: const name = ...;",
							);
							continue;
						}
						this.consts.push({
							decl: x,
							id: x.id,
							init: x.init,
							index: this.consts.length,
							exported,
						});
						if (exported) this.exported.add(x.id.name);
					}
					break;
				case "FunctionDeclaration":
					this.helpers.push({ decl: d, name: d.id.name, exported });
					if (exported) this.exported.add(d.id.name);
					break;
			}
		}
	}
	// An import: from the host, by a specifier it offers, or from another module.
	importFrom(d) {
		const spec = d.source.value;
		const hostModule = this.baseHost.imports.get(spec);
		if (hostModule !== undefined) {
			if (d.importKind === "type") {
				this.report(
					"unknown-import",
					d.source,
					`${JSON.stringify(spec)} is the host's: it offers values, not types`,
				);
				return;
			}
			for (const sp of d.specifiers) {
				const m = this.baseHost.member(hostModule, sp.imported.name);
				if (m === null) {
					this.report(
						"unknown-import",
						sp.imported,
						`${JSON.stringify(spec)} has no ${sp.imported.name}`,
					);
					continue;
				}
				this.imported.push({
					local: sp.local.name,
					binding: {
						kind: "import",
						type: m.ty,
						mode: "value",
						place: null,
						qualified: m.qualified,
					},
				});
			}
			return;
		}
		const sub = this.importModule(spec, d.source);
		if (sub === null) return;
		for (const [name, node] of Object.entries(sub.typeNodes))
			this.addTypeNode(name, node, d.source);
		for (const sp of d.specifiers) {
			const name = sp.imported.name;
			if (d.importKind === "type") {
				if (!sub.exports.types.has(name)) {
					this.report(
						"unknown-import",
						sp.imported,
						`${JSON.stringify(spec)} exports no type ${name}`,
					);
					continue;
				}
				if (sp.local.name !== name)
					this.addTypeNode(
						sp.local.name,
						{ type: "TypeRef", name, args: [], start: sp.start, end: sp.end },
						sp,
					);
				continue;
			}
			const b = sub.exports.values.get(name);
			if (b === undefined) {
				this.report("unknown-import", sp.imported, `${JSON.stringify(spec)} exports no ${name}`);
				continue;
			}
			this.imported.push({
				local: sp.local.name,
				binding: { ...b, kind: b.kind, qualified: b.qualified ?? `${spec}#${name}` },
			});
		}
	}
	importModule(spec, node) {
		if (this.resolve === null) {
			this.report(
				"unknown-import",
				node,
				`nothing says where ${JSON.stringify(spec)} is: the embedder resolves imports`,
			);
			return null;
		}
		if (this.cache.has(spec)) return this.cache.get(spec);
		if (this.visiting.has(spec)) {
			this.report("import-cycle", node, `${JSON.stringify(spec)} imports this module back`);
			return null;
		}
		const found = this.resolve(spec);
		if (found === null || found === undefined) {
			this.report("unknown-import", node, `there is no module ${JSON.stringify(spec)}`);
			return null;
		}
		const parsed =
			typeof found === "string" ? parseModule(found) : { module: found, diagnostics: [] };
		const inner =
			parsed.module === null ? [] : sieve(parsed.module, { profile: "module" }).diagnostics;
		if (parsed.module === null || inner.length > 0) {
			this.report(
				"import-error",
				node,
				`${JSON.stringify(spec)} doesn't check: ${(parsed.diagnostics[0] ?? inner[0]).message}`,
			);
			return null;
		}
		this.visiting.add(spec);
		const sub = new ModuleChecker(parsed.module, {
			host: this.baseHost,
			resolve: this.resolve,
			signatureOf: () => null,
			dataTypeOf: () => null,
			deterministic: this.deterministic,
			cache: this.cache,
			visiting: this.visiting,
			specifier: spec,
		}).run();
		this.visiting.delete(spec);
		if (sub.diagnostics.length > 0)
			this.report(
				"import-error",
				node,
				`${JSON.stringify(spec)} doesn't check: ${sub.diagnostics[0].message}`,
			);
		this.cache.set(spec, sub);
		return sub;
	}
	addTypeNode(name, node, at) {
		const had = this.typeNodes[name];
		if (had !== undefined && had !== node) {
			this.report(
				"type-name-clash",
				at,
				`two modules declare a type ${name}: types share one namespace`,
			);
			return;
		}
		this.typeNodes[name] = node;
	}
	// The host this module's code is checked against: the embedder's, with the module's types
	// (and those of the modules it imports).
	buildHost() {
		for (const d of this.localTypes) {
			if (this.baseHost.named.has(d.id.name)) {
				this.report("type-name-clash", d.id, `the host already has a type ${d.id.name}`);
				continue;
			}
			this.addTypeNode(d.id.name, d.type === "TypeAlias" ? d.typeAnnotation : d.body, d.id);
		}
		const host = this.baseHost.extend({ types: this.typeNodes });
		// A type that names what doesn't exist is reported once, here, and stands for unknown.
		for (const d of this.localTypes) {
			const node = d.type === "TypeAlias" ? d.typeAnnotation : d.body;
			let bad = false;
			host.toType(node, new Set(), (n, message) => {
				bad = true;
				this.report("unknown-type", n, message);
			});
			if (bad) host.named.get(d.id.name).ty = T.UNKNOWN;
		}
		return host;
	}
	makeChecker(program, signature = null) {
		return new Checker(program, {
			host: this.host,
			signature,
			deterministic: this.deterministic,
			outer: this.scope,
			typeTable: this.typeTable,
			moduleFunction: true,
		});
	}

	// The order consts and helpers are checked in: what each refers to first. A cycle of helpers
	// is a recursion; one through a const, a const that needs itself.
	order() {
		const names = new Map();
		for (const c of this.consts) names.set(c.id.name, { kind: "const", item: c });
		for (const h of this.helpers) names.set(h.name, { kind: "helper", item: h });
		const keys = new Set(names.keys());
		const refs = new Map();
		for (const [name, n] of names) {
			const node = n.kind === "const" ? n.item.init : n.item.decl.body;
			const ids = references(node, keys, true);
			refs.set(name, ids);
			if (n.kind === "helper")
				this.callGraph[name] = [
					...new Set(ids.filter((i) => names.get(i.name).kind === "helper").map((i) => i.name)),
				];
		}
		const out = [];
		const state = new Map(); // name -> "visiting" | "done"
		const stack = [];
		const visit = (name) => {
			const st = state.get(name);
			if (st === "done") return;
			if (st === "visiting") {
				const cycle = stack.slice(stack.indexOf(name));
				const allHelpers = cycle.every((c) => names.get(c).kind === "helper");
				const from = cycle.at(-1);
				const at = refs.get(from).find((i) => i.name === name);
				if (allHelpers)
					this.report(
						"recursive-call",
						at,
						`${[...cycle, name].join(" calls ")}: the functions of a module can't call themselves, so every run ends`,
					);
				else
					this.report(
						"const-cycle",
						at,
						`${[...cycle, name].join(" needs ")}: a const can't need itself`,
					);
				return;
			}
			state.set(name, "visiting");
			stack.push(name);
			for (const id of refs.get(name)) visit(id.name);
			stack.pop();
			state.set(name, "done");
			out.push(names.get(name));
		};
		for (const name of names.keys()) visit(name);
		this.constOrder(names, refs);
		return out;
	}
	// A const is made when its line runs, as in JavaScript: what its value needs (itself, or
	// through the functions it calls) must be made before it.
	constOrder(names, refs) {
		for (const c of this.consts) {
			const seen = new Set();
			const pending = refs.get(c.id.name).map((id) => ({ id, via: id }));
			while (pending.length > 0) {
				const { id, via } = pending.pop();
				const n = names.get(id.name);
				if (n.kind === "const") {
					if (n.item.index >= c.index)
						this.report(
							"const-order",
							via,
							n.item === c
								? `${c.id.name} needs itself to be made`
								: `${c.id.name} needs ${id.name}, which is declared after it: move ${id.name} up`,
						);
					continue;
				}
				if (seen.has(id.name)) continue;
				seen.add(id.name);
				for (const next of refs.get(id.name)) pending.push({ id: next, via });
			}
		}
	}

	// A helper's type before its body is checked: what its annotations say.
	provisional(h) {
		const fn = h.decl;
		const quiet = (node) => (node ? this.quietType(node) : T.UNKNOWN);
		const params = fn.params.map((p, i) => this.paramOf(p, i, quiet));
		const result = fn.returnType ? quiet(fn.returnType) : T.UNKNOWN;
		return {
			kind: "helper",
			type: T.fn([T.sig(params, result)]),
			mode: "value",
			place: null,
			qualified: h.name,
			fresh: false,
			mutParams: new Set(params.filter((p) => this.mutable(p.type)).map((p) => p.name)),
		};
	}
	quietType(node) {
		try {
			return T.withMut(
				this.baseHost.extend({ types: this.typeNodes }).toType(node, new Set(), () => {}),
				!isReadonlyNode(node),
			);
		} catch {
			return T.UNKNOWN;
		}
	}
	paramOf(p, i, typeOf) {
		const target = p.type === "AssignmentPattern" ? p.left : p;
		const rest = p.type === "RestElement";
		const node = rest ? p.typeAnnotation : target.typeAnnotation;
		const name =
			target.type === "Identifier"
				? target.name
				: rest && p.argument.type === "Identifier"
					? p.argument.name
					: `arg${i}`;
		return {
			name,
			type: node ? typeOf(node) : T.UNKNOWN,
			optional: p.type === "AssignmentPattern",
			rest,
		};
	}
	// Whether a parameter of type t may be changed: a container, or a named type that is one (or
	// a union holding one), not Readonly. An alias of strings or numbers can't be.
	mutable(t, seen = new Set()) {
		if (t.k === "union") return t.types.some((m) => this.mutable(m, seen));
		if (!t.mut) return false;
		if (t.k !== "ref") return T.isContainer(t);
		if (seen.has(t.name)) return true;
		seen.add(t.name);
		const r = this.host.resolve(t);
		return r.k === "handle" || this.mutable(r, seen);
	}
	checkHelper(h) {
		const fn = h.decl;
		if (fn.thisType)
			this.report(
				"helper-this",
				fn.thisType,
				`${h.name} is called by name, so nothing gives it a this: pass what it needs as a parameter`,
			);
		const program = {
			type: "PureProgram",
			form: "function",
			name: h.name,
			function: fn,
			source: this.src,
		};
		const c = this.makeChecker(program);
		const result = c.run();
		this.diagnostics.push(...c.diagnostics);
		const params = fn.params.map((p, i) =>
			this.paramOf(p, i, (node) => c.quietly(() => c.declaredType(node)).result),
		);
		const declaredResult = fn.returnType
			? c.quietly(() => c.declaredType(fn.returnType)).result
			: null;
		// Fresh: every value it returns is made in it, all the way down, so a caller may change it.
		const fresh =
			c.returnModes.some((m) => m === "fresh") &&
			c.returnTypes.every((t) => T.isPrimitive(t) || c.mayChange(t)) &&
			!(fn.returnType && isReadonlyNode(fn.returnType));
		const mutParams = new Set(params.filter((p) => this.mutable(p.type)).map((p) => p.name));
		const resultT = declaredResult ?? result;
		const binding = {
			kind: "helper",
			type: T.fn([T.sig(params, T.withMut(resultT, false))]),
			mode: "value",
			place: null,
			qualified: h.name,
			fresh,
			mutParams,
		};
		this.scope.names.set(h.name, binding);
		this.summaries[h.name] = {
			params: params.map((p) => ({
				name: p.name,
				type: T.typeToString(p.type),
				mutable: mutParams.has(p.name),
			})),
			result: T.typeToString(resultT),
			fresh,
		};
	}
	checkConst(c) {
		const checker = this.checker;
		const n0 = checker.diagnostics.length;
		let t;
		if (isNamespaceLiteral(c.init)) {
			if (c.id.typeAnnotation)
				this.report(
					"namespace-annotation",
					c.id.typeAnnotation,
					"a namespace's type is what it holds: it takes no annotation",
				);
			t = this.namespaceType(c.init, [c.id.name]);
		} else if (c.id.typeAnnotation) {
			const ann = checker.annotation(c.id.typeAnnotation, false);
			const v = checker.value(c.init, new Env(), ann);
			if (!checker.assignable(v, ann))
				checker.error("not-assignable", c.init, `${checker.show(v)} is not ${checker.show(ann)}`);
			t = T.withMut(ann, false);
		} else if (c.init?.type === "ObjectExpression" && this.typedMembers(c.init, [c.id.name]))
			t = T.withMut(this.dataRecord(c.init, [c.id.name]), false);
		else t = T.withMut(checker.value(c.init, new Env(), null), false);
		this.diagnostics.push(...checker.diagnostics.slice(n0));
		checker.diagnostics.length = n0;
		const kind = t.k === "record" && t.ns ? "namespace" : "const";
		this.scope.names.set(c.id.name, {
			kind,
			type: t,
			mode: kind === "namespace" ? "value" : "read",
			place: null,
		});
		checker.record(c.id, t, "read");
	}
	// A namespace's type: a record of its data members, read-only, that knows its entries are
	// there but can't be read or called.
	namespaceType(literal, path) {
		const fields = {};
		const entries = new Set();
		for (const p of literal.properties) {
			if (p.type === "SpreadElement") {
				this.report(
					"namespace-spread",
					p,
					"a namespace lists its members: it can't spread another value in",
				);
				continue;
			}
			const name = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			if (p.method || p.kind === "get") {
				entries.add(name);
				continue;
			}
			const t = isNamespaceLiteral(p.value)
				? this.namespaceType(p.value, [...path, name])
				: T.withMut(this.dataValue(p.value, [...path, name]), false);
			fields[name] = { type: t, optional: false, readonly: true };
		}
		const r = T.record(null, fields, {}, false, true);
		r.ns = path.join(".");
		r.entries = entries;
		return r;
	}
	// Whether the embedder types any member of a const's object literal.
	typedMembers(literal, path) {
		return literal.properties.some(
			(p) =>
				p.type === "Property" &&
				!p.computed &&
				this.dataTypeOf([
					...path,
					p.key.type === "Identifier" ? p.key.name : String(p.key.value),
				]) !== null,
		);
	}
	// A const's object literal whose members the embedder types: a record of what they are.
	dataRecord(literal, path) {
		const fields = {};
		for (const p of literal.properties) {
			if (p.type !== "Property" || p.computed) {
				this.checker.value(p.type === "SpreadElement" ? p.argument : p.value, new Env(), null);
				continue;
			}
			const name = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			fields[name] = {
				type: T.widen(this.dataValue(p.value, [...path, name])),
				optional: false,
				readonly: false,
			};
		}
		return T.record(null, fields, {}, true, false);
	}
	// A namespace's data member: of the type the embedder gives for its path, when it gives one.
	dataValue(node, path) {
		const text = this.dataTypeOf(path) ?? null;
		if (text === null) return this.checker.value(node, new Env(), null);
		const expected = this.checker.entryType(text);
		const v = this.checker.value(node, new Env(), expected);
		if (!this.checker.assignable(v, expected))
			this.checker.error(
				"not-assignable",
				node,
				`${path.join(".")} is ${this.checker.show(expected)}; this is ${this.checker.show(v)}`,
			);
		return v;
	}
	// An entry: checked against the signature the embedder gives for its path, or as its
	// annotations say.
	checkEntry(entry) {
		const signature = this.signatureOf(entry.path) ?? null;
		const program = {
			type: "PureProgram",
			form: entry.kind === "getter" ? "getter" : "method",
			name: entry.path.at(-1),
			function: entry.node,
			source: this.src,
		};
		const c = this.makeChecker(program, signature);
		const result = c.run();
		this.diagnostics.push(...c.diagnostics);
		return {
			path: entry.path,
			kind: entry.kind,
			node: entry.node,
			returnType: T.typeToString(result),
			returnTy: result,
		};
	}
}

// Checks a parsed module: { diagnostics, entries, exports, types, callGraph, summaries, host }.
// resolve(specifier) gives another module (its source or its tree) or null; signatureOf(path)
// the signature of the entry at path ({ this, params, result } as check takes), or null;
// dataTypeOf(path) the type (TypeScript text) a namespace's data member at path has, or null.
export const checkModule = (
	module,
	{
		host,
		resolve = null,
		signatureOf = () => null,
		dataTypeOf = () => null,
		deterministic = false,
	} = {},
) => {
	if (!(host instanceof Host))
		throw new TypeError("checkModule needs a host: new Host(...) or stdHost");
	return new ModuleChecker(module, {
		host,
		resolve,
		signatureOf,
		dataTypeOf,
		deterministic,
		cache: new Map(),
		visiting: new Set(),
		specifier: null,
	}).run();
};

// Parses, sieves (the module profile) and checks a module's source.
export const verifyModule = (source, options = {}) => {
	const parsed =
		typeof source === "string" ? parseModule(source) : { module: source, diagnostics: [] };
	if (parsed.diagnostics.length > 0) return { module: null, diagnostics: parsed.diagnostics };
	const sieved = sieve(parsed.module, { profile: options.profile ?? "module" });
	if (sieved.diagnostics.length > 0)
		return { module: parsed.module, diagnostics: sieved.diagnostics };
	return checkModule(parsed.module, options);
};
