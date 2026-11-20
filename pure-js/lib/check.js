// Well-formedness: a type system, as PurePy's is. Every name must be a parameter, a const or
// something the host provides; every property, method and operator must exist for the type it
// is used at; only what the entry signature makes mutable may change. Checking is
// bidirectional (an expected type flows into literals and callbacks) and flow-sensitive (tests
// and early returns narrow, assignments refine, calls that may change a value forget what was
// known of it), on paths of names and properties as TypeScript does.

import { Diagnostic } from "./diagnostic.js";
import { Host } from "./host.js";
import { typeOf } from "./parse.js";
import { METHODS, MODULE_ONLY_NAMES, PROPERTIES } from "./tables.js";
import * as T from "./types.js";

const TYPEOF_TAGS = T.union(
	["string", "number", "boolean", "undefined", "object", "function", "symbol", "bigint"].map(T.lit),
);
const MODULE_ONLY = new Set(MODULE_ONLY_NAMES);
// Readonly<T> or readonly T[]: an annotation that says the value isn't changed.
export const isReadonlyNode = (node) =>
	node.type === "TypeReadonly" || (node.type === "TypeRef" && node.name === "Readonly");

// The built-in methods as signatures, T standing for the receiver's elements.
const methodTables = (() => {
	const h = new Host();
	const out = {};
	for (const [kind, rows] of Object.entries(METHODS)) {
		out[kind] = {};
		for (const [name, row] of Object.entries(rows)) {
			const ty = h.toType(typeOf(row.sig, `${kind}.${name}`), new Set(["T"]));
			out[kind][name] = { ...row, sigs: ty.sigs };
		}
	}
	return out;
})();

export class Env {
	constructor(refine = new Map()) {
		this.refine = refine;
	}
	copy() {
		return new Env(new Map(this.refine));
	}
	forgetUnder(key) {
		if (key === null) return;
		for (const k of [...this.refine.keys()]) if (k.startsWith(`${key}.`)) this.refine.delete(k);
	}
}
const join = (a, b) => {
	if (a === null) return b;
	if (b === null) return a;
	const refine = new Map();
	for (const [k, t] of a.refine) if (b.refine.has(k)) refine.set(k, T.union([t, b.refine.get(k)]));
	return new Env(refine);
};
// What was forgotten in after (a call in a callback, the right of &&) is forgotten in env.
const forgetWhatWasForgotten = (env, after) => {
	for (const [k, t] of [...env.refine]) if (after.refine.get(k) !== t) env.refine.delete(k);
};

export class Scope {
	constructor(parent) {
		this.parent = parent;
		this.names = new Map();
	}
	lookup(name) {
		for (let s = this; s !== null; s = s.parent) if (s.names.has(name)) return s.names.get(name);
		return null;
	}
}

export class Checker {
	constructor(
		program,
		{ host, signature, deterministic, outer = null, typeTable = null, moduleFunction = false },
	) {
		// A module's function: its annotations say what may change (declaredType).
		this.moduleFunction = moduleFunction;
		this.program = program;
		this.src = program.source ?? "";
		this.host = host;
		this.signature = signature;
		this.deterministic = deterministic;
		this.diagnostics = [];
		// A module's names (its consts, helpers, namespaces, imports) are the scope outside.
		this.scope = outer;
		this.thisType = null;
		this.thisMode = "read";
		this.returns = [];
		this.returnModes = []; // the mode of each value returned, for a function's summary
		this.returnTypes = []; // and its type
		this.expectedReturn = null;
		this.draftName = null; // the first parameter the program may change, for help texts
		this.loops = []; // the loops being checked, innermost last: what break and continue flow to
		// node -> { t, mode, place }: what each expression is, for backends that need types.
		this.typeTable = typeTable;
		this.modes = new Map(); // node -> mode, as computed when it was last checked
	}
	error(code, node, message, help = null) {
		this.diagnostics.push(
			new Diagnostic({ code, stage: "check", message, start: node.start, end: node.end, help }),
		);
	}
	rel(bindings = null) {
		return new T.Relation(this.host, bindings);
	}
	assignable(s, t, bindings = null) {
		return this.rel(bindings).assignable(s, t);
	}
	resolve(t0) {
		let t = t0;
		while (t.k === "ref") t = this.host.resolve(t);
		return t;
	}
	// t with the aliases in it replaced by what they stand for, so a union's members show.
	expand(t) {
		if (t.k === "ref") {
			const r = this.host.resolve(t);
			return r.k === "record" || r.k === "handle" ? t : this.expand(r);
		}
		if (t.k === "union") return T.union(t.types.map((u) => this.expand(u)));
		return t;
	}
	show(t) {
		return T.typeToString(t);
	}
	text(node) {
		const s = this.src.slice(node.start, node.end).replace(/\s+/g, " ");
		return s.length > 40 ? `${s.slice(0, 37)}...` : s;
	}
	// Runs fn without keeping what it reports: to know a type, to try an overload.
	quietly(fn) {
		const n = this.diagnostics.length;
		const result = fn();
		const failed = this.diagnostics.length > n;
		this.diagnostics.length = n;
		return { result, failed };
	}
	annotation(node, mut = false) {
		return T.withMut(
			this.host.toType(node, new Set(), (n, message) => this.error("unknown-type", n, message)),
			mut,
		);
	}
	entryType(entry) {
		if (entry === undefined || entry === null) return null;
		const isEntry = typeof entry === "object" && "mode" in entry;
		const src = isEntry ? entry.type : entry;
		const node = typeof src === "string" ? typeOf(src, "the signature's type") : src;
		const ty = this.host.toType(node);
		return T.withMut(ty, isEntry && entry.mode === "draft");
	}
	// The mode of a value bound from an entry: draft when the program may change it.
	entryMode(entry) {
		return typeof entry === "object" && entry !== null && entry.mode === "draft" ? "draft" : "read";
	}
	// An annotation in a module's function: a container written plainly may change (callers must
	// give a value that may), written Readonly<T> or readonly T[] it may not.
	declaredType(node) {
		return this.annotation(node, !isReadonlyNode(node));
	}

	// Names.
	declare(id, type, kind, extra = {}) {
		const name = id.name;
		if (
			this.scope.lookup(name) !== null ||
			this.host.binding(name) !== null ||
			name === "undefined"
		) {
			this.error("shadowed-name", id, `${name} is already a name here: pick another one`);
		}
		const containerish = T.members(type).some((u) => T.isContainer(u) || u.k === "ref");
		const mode = !containerish
			? T.members(type).some((u) => u.k === "handle")
				? "read"
				: "value"
			: (extra.mode ?? (T.members(type).some((u) => u.mut) ? "fresh" : "read"));
		const place = mode === "draft" ? (extra.place ?? null) : null;
		this.scope.names.set(name, { kind, type, mode, place });
		this.record(id, type, mode, place);
	}
	// Binds what a pattern names, from a value of type (of mode, at place when it's a draft's).
	bindPattern(p, type, kind, mode = null, place = null) {
		const sub = (m) => (mode === "draft" ? "draft" : m);
		switch (p.type) {
			case "Identifier":
				return this.declare(p, type, kind, { mode: mode ?? undefined, place });
			case "AssignmentPattern": {
				const dt = this.value(p.right, new Env(), T.removeNullish(type));
				if (
					!this.assignable(
						dt,
						T.filterUnion(type, (u) => u.k !== "undefined"),
					) &&
					!this.assignable(dt, type)
				)
					this.error(
						"not-assignable",
						p.right,
						`the default is ${this.show(dt)}, where ${this.show(type)} is expected`,
					);
				const t = T.union([T.filterUnion(type, (u) => u.k !== "undefined"), dt]);
				return this.bindPattern(p.left, t, kind, mode, null);
			}
			case "ObjectPattern":
				return this.objectPattern(p, type, kind, sub, place);
			case "ArrayPattern":
				break;
			default:
				return;
		}
		const t = this.resolve(type);
		p.elements.forEach((e, i) => {
			if (e === null) return;
			if (e.type === "RestElement") {
				const rest =
					t.k === "tuple"
						? T.tuple(
								t.elems.slice(i).map((_, j) => T.tupleElemOf(t, i + j)),
								true,
								false,
							)
						: t.k === "list"
							? T.list(T.elemOf(t), true, false)
							: T.list(T.UNKNOWN, true, false);
				this.bindPattern(e.argument, rest, kind, "fresh");
				return;
			}
			let et;
			if (t.k === "tuple") {
				if (i >= t.elems.length) {
					this.error(
						"pattern-type",
						e,
						`the pattern takes element ${i + 1}, but ${this.show(t)} has ${t.elems.length}`,
					);
					et = T.UNKNOWN;
				} else et = T.tupleElemOf(t, i);
			} else if (t.k === "list") et = T.union([T.elemOf(t), T.UNDEFINED]);
			else {
				if (t.k !== "unknown" || i === 0)
					this.error(
						"pattern-type",
						p,
						`an array pattern takes a list or a tuple, not ${this.show(t)}`,
					);
				et = T.UNKNOWN;
			}
			this.bindPattern(
				e,
				et,
				kind,
				mode === "draft" ? "draft" : null,
				place === null ? null : `${place}[${i}]`,
			);
		});
	}
	objectPattern(p, type, kind, sub, place) {
		const t = this.resolve(T.removeNullish(type));
		if (T.hasNullish(type))
			this.error(
				"possibly-null",
				p,
				`the value destructured may be ${this.show(T.filterUnion(type, T.isNullish))}: check it first`,
			);
		const taken = new Set();
		for (const prop of p.properties) {
			if (prop.type === "RestElement") {
				let rest = T.record(null, {}, {}, true, false);
				if (t.k === "record") {
					const fields = {};
					for (const [n, f] of Object.entries(t.fields))
						if (!taken.has(n))
							fields[n] = { type: T.fieldTypeOf(t, f), optional: f.optional, readonly: false };
					rest = T.record(null, fields, {}, true, false);
				} else if (t.k === "dict") rest = T.dict(T.dictValueOf(t), true, false);
				this.bindPattern(prop.argument, rest, kind, "fresh");
				continue;
			}
			const name = prop.key.type === "Identifier" ? prop.key.name : String(prop.key.value);
			taken.add(name);
			let ft;
			if (t.k === "record" || t.k === "handle") {
				const f = t.fields[name];
				if (f === undefined) {
					this.error("unknown-property", prop.key, `${this.show(t)} has no ${name}`);
					ft = T.UNKNOWN;
				} else {
					ft = T.fieldTypeOf(t, f);
					if (f.optional) ft = T.union([ft, T.UNDEFINED]);
					if (t.k === "handle") ft = T.withMut(ft, false);
				}
			} else if (t.k === "dict") ft = T.union([T.dictValueOf(t), T.UNDEFINED]);
			else {
				this.error(
					"pattern-type",
					p,
					`an object pattern takes a record or a dictionary, not ${this.show(t)}`,
				);
				ft = T.UNKNOWN;
			}
			this.bindPattern(prop.value, ft, kind, sub(null), place === null ? null : `${place}.${name}`);
		}
	}
	// What a node is, for the typed tree.
	record(node, t, mode, place = null) {
		if (this.typeTable !== null) this.typeTable.set(node, { t, mode, place });
	}
	pushScope() {
		this.scope = new Scope(this.scope);
	}
	popScope() {
		this.scope = this.scope.parent;
	}
	pathKey(e) {
		if (e.type === "ThisExpression") return "this";
		if (e.type === "Identifier") return this.scope.lookup(e.name) !== null ? e.name : null;
		if (e.type === "MemberExpression" && !e.computed && !e.optional) {
			const o = this.pathKey(e.object);
			return o === null ? null : `${o}.${e.property.name}`;
		}
		return null;
	}
	describe(e) {
		const key = this.pathKey(e);
		return key ?? this.text(e);
	}

	// The program.
	run() {
		const p = this.program;
		const fn = p.function;
		const sigd = this.signature;
		this.pushScope();
		if (sigd?.this !== undefined && sigd?.this !== null && p.form !== "arrow") {
			this.thisType = this.entryType(sigd.this);
			this.thisMode = this.entryMode(sigd.this);
		}
		if (fn.thisType) {
			const ann = this.moduleFunction
				? this.declaredType(fn.thisType)
				: this.annotation(fn.thisType);
			if (this.thisType !== null && !this.assignable(this.thisType, ann))
				this.error(
					"param-type",
					fn.thisType,
					`this is ${this.show(this.thisType)}, not ${this.show(ann)}`,
				);
			if (this.thisType === null) {
				this.thisType = ann;
				this.thisMode = this.topMut(ann) ? "draft" : "read";
			}
		}
		const params = sigd?.params ?? null;
		fn.params.forEach((param, i) => {
			let type = params === null ? null : this.entryType(params[i]);
			let mode = params === null || params[i] === undefined ? null : this.entryMode(params[i]);
			if (params !== null && i >= params.length) {
				this.error(
					"too-many-params",
					param,
					`the signature has ${params.length} parameters, this is parameter ${i + 1}`,
				);
			}
			if (param.typeAnnotation) {
				const ann =
					this.moduleFunction && type === null
						? this.declaredType(param.typeAnnotation)
						: this.annotation(param.typeAnnotation, type?.mut ?? false);
				if (type !== null && !this.assignable(type, ann))
					this.error(
						"param-type",
						param.typeAnnotation,
						`the parameter is ${this.show(type)}, not ${this.show(ann)}`,
					);
				if (type === null) {
					type = ann;
					mode = this.topMut(ann) ? "draft" : "read";
				}
			}
			if (type === null) {
				this.error(
					"missing-param-type",
					param,
					"the parameter needs a type: annotate it or give the program a signature",
				);
				type = T.UNKNOWN;
			}
			this.bindPattern(
				param,
				type,
				"param",
				mode,
				mode === "draft" && param.type === "Identifier" ? param.name : null,
			);
			if (this.draftName === null && param.type === "Identifier" && this.topMut(type))
				this.draftName = param.name;
		});
		if (fn.returnType) {
			this.expectedReturn = this.annotation(fn.returnType);
			const declared = sigd?.result === undefined ? null : this.entryType(sigd.result);
			if (declared !== null && !this.assignable(this.expectedReturn, declared))
				this.error(
					"return-type",
					fn.returnType,
					`the signature returns ${this.show(declared)}, not ${this.show(this.expectedReturn)}`,
				);
		} else if (sigd?.result !== undefined && sigd?.result !== null) {
			this.expectedReturn = this.entryType(sigd.result);
		}
		let completes;
		if (fn.body.type === "BlockStatement") {
			completes = this.statements(fn.body.body, new Env()) !== null;
		} else {
			const t = this.value(fn.body, new Env(), this.expectedValueReturn());
			this.checkReturned(fn.body, t);
			completes = false;
		}
		const expected = this.expectedReturn;
		if (
			completes &&
			expected !== null &&
			!this.assignable(T.UNDEFINED, expected) &&
			expected.k !== "void"
		) {
			this.error(
				"missing-return",
				fn.body,
				`the function must return ${this.show(expected)} on every path`,
			);
		}
		this.popScope();
		if (expected !== null) return expected;
		if (this.returns.length === 0) return T.VOID;
		return T.union([...this.returns.map(T.widen), ...(completes ? [T.UNDEFINED] : [])]);
	}
	expectedValueReturn() {
		const e = this.expectedReturn;
		return e === null || e.k === "void" ? null : e;
	}
	checkReturned(node, t) {
		this.returnModes.push(this.modeOf(node));
		this.returnTypes.push(t);
		const e = this.expectedReturn;
		if (e === null) {
			this.returns.push(t);
			return;
		}
		if (e.k === "void") {
			this.error("return-value", node, "the function returns nothing: write return; alone");
			return;
		}
		if (!this.assignable(t, e))
			this.error("return-type", node, `it returns ${this.show(e)}, and this is ${this.show(t)}`);
	}

	// Statements: each takes the flow state before it and returns the one after it, or null
	// when the statement never completes (it returns on every path).
	statements(list, env) {
		let current = env;
		for (const s of list) {
			if (current === null) {
				this.error(
					"unreachable-code",
					s,
					"this statement never runs: a return before it always happens",
				);
				return null;
			}
			current = this.statement(s, current);
		}
		return current;
	}
	statement(s, env) {
		switch (s.type) {
			case "VariableDeclaration":
				for (const d of s.declarations) {
					if (d.init === null) {
						this.error("let-needs-value", d, "a let needs a value to start with: let x = ...;");
						if (d.id.type === "Identifier")
							this.declare(
								d.id,
								d.id.typeAnnotation ? this.annotation(d.id.typeAnnotation, true) : T.UNKNOWN,
								s.kind,
							);
						continue;
					}
					let t;
					let declared;
					if (d.id.typeAnnotation) {
						const ann = this.annotation(d.id.typeAnnotation, true);
						t = this.value(d.init, env, ann);
						if (!this.assignable(t, ann))
							this.error("not-assignable", d.init, `${this.show(t)} is not ${this.show(ann)}`);
						declared = T.withMut(ann, this.topMut(t));
					} else {
						t = this.value(d.init, env, null);
						// A let holds what is assigned later too: a literal type is widened.
						declared = s.kind === "let" ? T.widen(t) : t;
					}
					const mode = this.modeOf(d.init);
					const place = s.kind === "const" && mode === "draft" ? this.placeOf(d.init) : null;
					this.bindPattern(d.id, declared, s.kind, mode === "value" ? null : mode, place);
					// A let starts known to hold what it was given.
					if (s.kind === "let" && d.id.type === "Identifier" && declared !== t)
						env.refine.set(d.id.name, t);
				}
				return env;
			case "ForOfStatement":
				return this.forOf(s, env);
			case "BreakStatement":
			case "ContinueStatement": {
				const loop = this.loops.at(-1);
				if (loop !== undefined) loop.exits.push(env.copy());
				return null;
			}
			case "ExpressionStatement": {
				const e = s.expression;
				if (e.type === "AssignmentExpression") this.assignment(e, env);
				else this.expr(e, env, null);
				return env;
			}
			case "IfStatement": {
				this.test(s.test, env);
				const then = this.statement(s.consequent, this.narrow(s.test, env, true));
				const otherwise =
					s.alternate === null
						? this.narrow(s.test, env, false)
						: this.statement(s.alternate, this.narrow(s.test, env, false));
				const out = join(then, otherwise);
				return out;
			}
			case "BlockStatement": {
				this.pushScope();
				const out = this.statements(s.body, env);
				this.popScope();
				return out;
			}
			case "ReturnStatement":
				if (s.argument === null) {
					const e = this.expectedReturn;
					if (e !== null && e.k !== "void" && !this.assignable(T.UNDEFINED, e))
						this.error("return-type", s, `it returns ${this.show(e)}: return a value`);
				} else {
					const t = this.value(s.argument, env, this.expectedValueReturn());
					this.checkReturned(s.argument, t);
				}
				return null;
			default:
				// Forms the sieve stops (for-of, try, ...): nothing is known of them.
				return env;
		}
	}
	topMut(t) {
		return T.isContainer(t) || t.k === "ref" ? t.mut : false;
	}
	// for (const x of xs): xs a list, a tuple or a string, walked as it was when the loop began.
	// The body runs any number of times, so what it changes isn't known when it starts, and
	// after the loop what was known is what holds after every way out of it.
	forOf(s, env) {
		const it = this.value(s.right, env, null);
		const r = this.resolve(this.expand(it));
		let elem;
		if (r.k === "list") elem = T.elemOf(r);
		else if (r.k === "tuple") elem = T.union(r.elems.map((_, i) => T.tupleElemOf(r, i)));
		else if (this.receiverKind(r) === "string") elem = T.STRING;
		else {
			this.error(
				"not-iterable",
				s.right,
				`for-of walks a list or a string; ${this.describe(s.right)} is ${this.show(it)}`,
				r.k === "dict" ? "walk Object.entries(...), Object.keys(...) or Object.values(...)" : null,
			);
			elem = T.UNKNOWN;
		}
		const start = env.copy();
		this.forgetChangedIn(s.body, start);
		const loop = { exits: [] };
		this.loops.push(loop);
		this.pushScope();
		const d = s.left.declarations[0];
		const mode = this.modeOf(s.right);
		const place = mode === "draft" ? this.placeOf(s.right) : null;
		if (d.id.typeAnnotation) {
			const ann = this.annotation(d.id.typeAnnotation, this.topMut(elem));
			if (!this.assignable(elem, ann))
				this.error(
					"param-type",
					d.id.typeAnnotation,
					`the loop gives ${this.show(elem)}, not ${this.show(ann)}`,
				);
			elem = ann;
		}
		this.bindPattern(
			d.id,
			elem,
			s.left.kind,
			mode === "draft" ? "draft" : null,
			place === null ? null : `${place}[*]`,
		);
		const end = this.statement(s.body, start.copy());
		this.popScope();
		this.loops.pop();
		let out = join(start, end);
		for (const x of loop.exits) out = join(out, x);
		return out;
	}
	// What a statement may change, forgotten in env: names it assigns, places it sets, and what
	// is under anything it calls a method or a host function on.
	forgetChangedIn(node, env) {
		const visit = (n) => {
			if (n === null || typeof n !== "object") return;
			if (Array.isArray(n)) return n.forEach(visit);
			if (n.type === "AssignmentExpression") {
				const key = n.left.type === "Identifier" ? n.left.name : this.pathKey(n.left);
				if (key !== null) {
					env.refine.delete(key);
					env.forgetUnder(key);
				}
				if (n.left.type === "MemberExpression") env.forgetUnder(this.pathKey(n.left.object));
			}
			if (n.type === "CallExpression") {
				for (const k of [...env.refine.keys()])
					if (k.includes(".") || k === "this") env.refine.delete(k);
			}
			for (const k of Object.keys(n)) if (k !== "type" && typeof n[k] === "object") visit(n[k]);
		};
		visit(node);
	}
	test(e, env) {
		const t = this.value(e, env, null);
		if (!T.isTestable(t)) {
			this.error(
				"not-testable",
				e,
				`a test takes a boolean, or a value that may be null or undefined; ${this.describe(e)} is ${this.show(t)}`,
				'compare it: === "", === 0, > 0',
			);
		}
		return t;
	}

	// Narrowing: the flow state where cond is (sense true) or isn't (false) truthy.
	narrow(cond, env, sense) {
		const out = env.copy();
		this.narrowInto(cond, out, sense);
		return out;
	}
	typeOfPath(e, env) {
		return this.quietly(() => this.value(e, env, null)).result;
	}
	refinePath(e, env, f) {
		const key = this.pathKey(e);
		if (key === null) return;
		env.refine.set(key, f(this.expand(this.typeOfPath(e, env))));
	}
	narrowInto(cond, env, sense) {
		switch (cond.type) {
			case "UnaryExpression":
				if (cond.operator === "!") this.narrowInto(cond.argument, env, !sense);
				return;
			case "LogicalExpression": {
				if (cond.operator === "??") return;
				const and = cond.operator === "&&";
				if (and === sense) {
					this.narrowInto(cond.left, env, sense);
					this.narrowInto(cond.right, env, sense);
					return;
				}
				// !(a && b): !a, or a and !b. a || b false: !a and !b handled above.
				const viaLeft = this.narrow(cond.left, env, sense);
				const viaRight = this.narrow(cond.right, this.narrow(cond.left, env, !sense), sense);
				const merged = join(viaLeft, viaRight);
				env.refine = merged.refine;
				return;
			}
			case "BinaryExpression": {
				if (cond.operator !== "===" && cond.operator !== "!==") return;
				const s = cond.operator === "===" ? sense : !sense;
				const sides = [
					[cond.left, cond.right],
					[cond.right, cond.left],
				];
				for (const [a, b] of sides) {
					if (
						a.type === "UnaryExpression" &&
						a.operator === "typeof" &&
						b.type === "Literal" &&
						typeof b.value === "string"
					) {
						this.refinePath(a.argument, env, (t) => T.narrowTypeof(t, b.value, s));
						return;
					}
				}
				for (const [a, b] of sides) {
					const v = this.constantType(b);
					if (v === null) continue;
					this.refinePath(a, env, (t) => T.narrowEquals(t, v, s));
					// A discriminant: x.kind === "a" narrows x to the records whose kind can be "a".
					if (a.type === "MemberExpression" && !a.computed && v.k === "lit") {
						const field = a.property.name;
						this.refinePath(a.object, env, (t) =>
							T.filterUnion(t, (u) => {
								const r = this.resolve(u);
								if (r.k !== "record" || r.fields[field] === undefined) return true;
								const ft = T.fieldTypeOf(r, r.fields[field]);
								return s ? this.rel().comparable(ft, v) : !(ft.k === "lit" && ft.value === v.value);
							}),
						);
					}
					return;
				}
				return;
			}
			case "ChainExpression": {
				// a?.b truthy: a isn't null or undefined.
				if (sense) {
					let e = cond.expression;
					while (e.type === "MemberExpression" || e.type === "CallExpression") {
						const obj =
							e.type === "MemberExpression"
								? e.object
								: e.callee.type === "MemberExpression"
									? e.callee.object
									: null;
						const optional =
							e.type === "MemberExpression"
								? e.optional
								: e.callee.type === "MemberExpression" && e.callee.optional;
						if (obj === null) break;
						if (optional) this.refinePath(obj, env, T.removeNullish);
						e = obj;
					}
				}
				return;
			}
			default:
				this.refinePath(cond, env, (t) => T.narrowTruthy(t, sense));
		}
	}
	constantType(e) {
		if (e.type === "Literal") return e.value === null ? T.NULL : T.lit(e.value);
		if (
			e.type === "Identifier" &&
			e.name === "undefined" &&
			this.scope.lookup("undefined") === null
		)
			return T.UNDEFINED;
		return null;
	}

	// Expressions. value() is an expression used as a value: a module or a function can't be one.
	value(e, env, expected) {
		const t = this.expr(e, env, expected);
		if (t.k === "module") {
			this.error("module-as-value", e, `${this.text(e)} is a module: use one of its members`);
			return T.UNKNOWN;
		}
		if (t.k === "fn") {
			this.error("function-as-value", e, `${this.text(e)} is a function: call it`);
			return T.UNKNOWN;
		}
		if (t.k === "record" && t.ns) {
			this.error(
				"namespace-as-value",
				e,
				`${this.text(e)} holds entries the embedder calls, so it isn't a value: read its data members`,
			);
			return T.UNKNOWN;
		}
		if (t.k === "void") {
			this.error("void-value", e, `${this.text(e)} returns nothing, so it has no value to use`);
			return T.UNDEFINED;
		}
		return t;
	}
	// A value checked against what is expected of it.
	checked(e, env, expected, what = null) {
		const t = this.value(e, env, expected);
		if (expected !== null && !this.assignable(t, expected)) {
			this.error(
				"not-assignable",
				e,
				`${what ?? this.describe(e)} is ${this.show(t)}, where ${this.show(expected)} is expected`,
			);
		}
		return t;
	}
	expr(e, env, expected) {
		const t = this.exprType(e, env, expected);
		const mode = this.computeMode(e, t);
		this.modes.set(e, mode);
		this.record(e, t, mode, mode === "draft" ? this.placeOf(e) : null);
		return t;
	}
	// What a value is to whoever changes it: a draft's (part of a value the entry gave to be
	// changed), fresh (made here), read, or a plain value (a primitive).
	computeMode(e, t) {
		const containerish = T.members(t).some((u) => T.isContainer(u) || u.k === "ref");
		if (!containerish) return T.members(t).some((u) => u.k === "handle") ? "read" : "value";
		if (!T.members(t).some((u) => (T.isContainer(u) || u.k === "ref") && u.mut)) return "read";
		const of = (x) => this.modes.get(x) ?? "value";
		switch (e.type) {
			case "Identifier":
				return this.scope.lookup(e.name)?.mode ?? "read";
			case "ThisExpression":
				return this.thisMode;
			case "MemberExpression":
				return of(e.object) === "draft" ? "draft" : "fresh";
			case "ChainExpression":
				return of(e.expression);
			case "CallExpression": {
				const c = e.callee;
				if (
					c.type === "MemberExpression" &&
					!c.computed &&
					methodTables.list[c.property.name]?.self
				)
					return of(c.object) === "draft" ? "draft" : "fresh";
				return "fresh";
			}
			case "ConditionalExpression":
				return of(e.consequent) === "draft" || of(e.alternate) === "draft" ? "draft" : "fresh";
			case "LogicalExpression":
				return of(e.left) === "draft" || of(e.right) === "draft" ? "draft" : "fresh";
			default:
				return "fresh";
		}
	}
	modeOf(e) {
		return this.modes.get(e) ?? "value";
	}
	// Where a draft's value is, as a path from a name: next.items[i].done. null when it isn't one
	// path (a conditional, an index that isn't a name or a literal).
	placeOf(e) {
		switch (e.type) {
			case "Identifier": {
				const b = this.scope.lookup(e.name);
				return b?.place ?? null;
			}
			case "ThisExpression":
				return "this";
			case "ChainExpression":
				return null;
			case "MemberExpression": {
				const o = this.placeOf(e.object);
				if (o === null) return null;
				if (!e.computed) return `${o}.${e.property.name}`;
				const k = e.property;
				if (k.type === "Literal") return `${o}[${JSON.stringify(k.value)}]`;
				if (k.type === "Identifier") {
					const b = this.scope.lookup(k.name);
					if (b !== null && b.kind !== "let") return `${o}[${k.name}]`;
				}
				return null;
			}
			default:
				return null;
		}
	}
	exprType(e, env, expected) {
		switch (e.type) {
			case "Identifier":
				return this.identifier(e, env);
			case "ThisExpression":
				if (this.thisType === null) {
					this.error(
						"this-unavailable",
						e,
						this.program.form === "arrow"
							? "an arrow program has no this: write a function"
							: "the signature gives this program no this",
					);
					return T.NEVER;
				}
				return env.refine.get("this") ?? this.thisType;
			case "Literal":
				return e.value === null ? T.NULL : T.lit(e.value);
			case "TemplateLiteral":
				for (const x of e.expressions) {
					const t = this.value(x, env, null);
					if (!T.isPrimitive(t))
						this.error(
							"template-type",
							x,
							`a template takes strings, numbers and booleans; ${this.describe(x)} is ${this.show(t)}`,
						);
				}
				return T.STRING;
			case "MemberExpression":
			case "CallExpression":
				return this.link(e, env).t;
			case "ChainExpression": {
				const { t, short } = this.link(e.expression, env);
				return short ? T.union([t, T.UNDEFINED]) : t;
			}
			case "ArrayExpression":
				return this.arrayLiteral(e, env, expected);
			case "ObjectExpression":
				return this.objectLiteral(e, env, expected);
			case "UnaryExpression":
				return this.unary(e, env);
			case "BinaryExpression":
				return this.binary(e, env);
			case "LogicalExpression":
				return this.logical(e, env, expected);
			case "ConditionalExpression": {
				this.test(e.test, env);
				const a = this.value(e.consequent, this.narrow(e.test, env, true), expected);
				const b = this.value(e.alternate, this.narrow(e.test, env, false), expected);
				return T.union([a, b]);
			}
			case "AssignmentExpression":
				this.assignment(e, env);
				return T.UNKNOWN;
			case "ArrowFunctionExpression":
				this.error("function-as-value", e, "an arrow function is only a call's argument");
				return T.UNKNOWN;
			default:
				return T.UNKNOWN;
		}
	}
	identifier(e, env) {
		const b = this.scope.lookup(e.name);
		if (b !== null) return env.refine.get(e.name) ?? b.type;
		if (e.name === "undefined") return T.UNDEFINED;
		const h = this.host.binding(e.name);
		if (h !== null) return h.kind === "module" ? T.moduleType(e.name) : h.call;
		this.error(
			"unknown-name",
			e,
			`${e.name} is not a parameter, a const or something the host provides`,
		);
		return T.NEVER;
	}
	unary(e, env) {
		switch (e.operator) {
			case "!":
				this.test(e.argument, env);
				return T.BOOLEAN;
			case "-": {
				const t = this.value(e.argument, env, null);
				if (!T.isNumberish(t))
					this.error(
						"operand-type",
						e.argument,
						`unary - takes a number; ${this.describe(e.argument)} is ${this.show(t)}`,
					);
				return T.NUMBER;
			}
			case "typeof":
				this.value(e.argument, env, null);
				return TYPEOF_TAGS;
			default:
				this.value(e.argument, env, null);
				return T.UNKNOWN;
		}
	}
	binary(e, env) {
		const a = this.value(e.left, env, null);
		const b = this.value(e.right, env, null);
		const op = e.operator;
		const both = (p) => p(a) && p(b);
		const bad = (what) =>
			this.error(
				"operand-type",
				e,
				`${op} takes ${what}; here ${this.show(T.widen(a))} and ${this.show(T.widen(b))}`,
				op === "+" ? "convert with String(x) or a template" : null,
			);
		switch (op) {
			case "+":
				if (both(T.isNumberish)) return T.NUMBER;
				if (both(T.isStringish)) return T.STRING;
				bad("two numbers or two strings");
				return T.NEVER;
			case "-":
			case "*":
			case "/":
			case "%":
				if (!both(T.isNumberish)) bad("two numbers");
				return T.NUMBER;
			case "<":
			case ">":
			case "<=":
			case ">=":
				if (!both(T.isNumberish) && !both(T.isStringish)) bad("two numbers or two strings");
				return T.BOOLEAN;
			case "===":
			case "!==":
				if (!this.rel().comparable(a, b))
					this.error(
						"comparison-type",
						e,
						`${this.show(a)} and ${this.show(b)} have no value in common, so ${op} is always ${op === "===" ? "false" : "true"}`,
					);
				return T.BOOLEAN;
			default:
				return T.UNKNOWN;
		}
	}
	logical(e, env, expected) {
		const left = this.value(e.left, env, null);
		if (e.operator !== "??" && !T.isTestable(left)) {
			this.error(
				"not-testable",
				e.left,
				`${e.operator} takes a boolean, or a value that may be null or undefined, on its left; ${this.describe(e.left)} is ${this.show(left)}`,
			);
		}
		const renv =
			e.operator === "&&"
				? this.narrow(e.left, env, true)
				: e.operator === "||"
					? this.narrow(e.left, env, false)
					: env.copy();
		if (e.operator === "??") this.refinePath(e.left, renv, (t) => T.filterUnion(t, T.isNullish));
		const right = this.value(e.right, renv, expected);
		forgetWhatWasForgotten(env, renv);
		switch (e.operator) {
			case "&&":
				return T.union([T.narrowTruthy(left, false), right]);
			case "||":
				return T.union([T.narrowTruthy(left, true), right]);
			default:
				return T.union([T.removeNullish(left), right]);
		}
	}

	// Member access and calls, links of a chain: { t, short }, short when an optional link
	// may make the whole chain undefined.
	link(e, env) {
		if (e.type === "CallExpression") return this.call(e, env);
		const { t: objT0, short: s0 } = this.object(e.object, env);
		let objT = objT0;
		let short = s0;
		if (e.optional) {
			if (T.hasNullish(objT)) short = true;
			objT = T.removeNullish(objT);
		}
		if (e.computed) return { t: this.index(e, objT, env), short };
		const name = e.property.name;
		if (objT.k === "module") {
			const m = this.host.member(objT.name, name);
			if (m === null) {
				this.error("unknown-member", e.property, `the module ${objT.name} has no ${name}`);
				return { t: T.NEVER, short };
			}
			return { t: m.ty, short };
		}
		if (MODULE_ONLY.has(name)) {
			this.error("reserved-name", e.property, `only a module's member may be called ${name}`);
			return { t: T.NEVER, short };
		}
		const key = this.pathKey(e);
		if (key !== null && env.refine.has(key)) return { t: env.refine.get(key), short };
		return { t: this.property(e, objT, name), short };
	}
	// The object of a member or the receiver of a method: a link when it is one (whose mode is
	// known too, so the member it is the object of has one).
	object(e, env) {
		if (e.type === "MemberExpression" || e.type === "CallExpression") {
			const r = this.link(e, env);
			this.modes.set(e, this.computeMode(e, r.t));
			return r;
		}
		return { t: this.expr(e, env, null), short: false };
	}
	property(e, objT0, name) {
		let objT = objT0;
		if (T.hasNullish(objT)) {
			this.error(
				"possibly-null",
				e.object,
				`${this.describe(e.object)} may be ${this.show(T.filterUnion(objT, T.isNullish))}: check it first, or use ?.`,
			);
			objT = T.removeNullish(objT);
		}
		const out = [];
		for (const u0 of T.members(this.expand(objT))) {
			const u = this.resolve(u0);
			const t = this.propertyOf(e, u, name);
			if (t === null) return T.NEVER;
			out.push(t);
		}
		return T.union(out);
	}
	propertyOf(e, u, name) {
		const where = this.describe(e.object);
		const kind = this.receiverKind(u);
		switch (u.k) {
			case "record":
			case "handle": {
				if (u.entries?.has(name)) {
					this.error(
						"entry-access",
						e.property,
						`${where}.${name} is an entry the embedder calls, not something code reads or calls: move what both need to a function`,
					);
					return null;
				}
				const f = u.fields[name];
				if (f !== undefined)
					return u.k === "handle" ? T.withMut(T.fieldTypeOf(u, f), false) : T.fieldTypeOf(u, f);
				if (u.methods[name] !== undefined) {
					this.error(
						"method-not-called",
						e.property,
						`${name} is a method of ${this.show(u)}: call it`,
					);
					return null;
				}
				this.error("unknown-property", e.property, `${this.show(u)} has no ${name}`);
				return null;
			}
			case "dict":
				this.error(
					"dict-dot-access",
					e.property,
					`${where} is a dictionary: read it as ${where}[${JSON.stringify(name)}]`,
				);
				return null;
			case "unknown":
				this.error(
					"unknown-member",
					e,
					`nothing is known of ${where} (it is unknown): narrow it first, with typeof`,
				);
				return null;
			default:
				if (kind !== null) {
					const p = PROPERTIES[kind]?.[name];
					if (p !== undefined) return T.primitive(p);
					if (methodTables[kind]?.[name] !== undefined) {
						this.error("method-not-called", e.property, `${name} is a method: call it`);
						return null;
					}
				}
				this.error("unknown-property", e.property, `${this.show(u)} has no property ${name}`);
				return null;
		}
	}
	receiverKind(u) {
		if (u.k === "list" || u.k === "tuple") return "list";
		if (u.k === "string" || (u.k === "lit" && typeof u.value === "string")) return "string";
		if (u.k === "number" || (u.k === "lit" && typeof u.value === "number")) return "number";
		return null;
	}
	index(e, objT0, env) {
		const kt = this.value(e.property, env, null);
		let objT = objT0;
		if (T.hasNullish(objT)) {
			this.error(
				"possibly-null",
				e.object,
				`${this.describe(e.object)} may be ${this.show(T.filterUnion(objT, T.isNullish))}: check it first`,
			);
			objT = T.removeNullish(objT);
		}
		const out = [];
		for (const u0 of T.members(this.expand(objT))) {
			const u = this.resolve(u0);
			if (u.k === "list" || u.k === "tuple" || this.receiverKind(u) === "string") {
				if (!T.isNumberish(kt)) {
					this.error(
						"index-type",
						e.property,
						`a list or a string is indexed by a number; ${this.describe(e.property)} is ${this.show(kt)}`,
					);
					return T.UNKNOWN;
				}
				if (
					u.k === "tuple" &&
					kt.k === "lit" &&
					Number.isInteger(kt.value) &&
					kt.value >= 0 &&
					kt.value < u.elems.length
				) {
					out.push(T.tupleElemOf(u, kt.value));
				} else if (u.k === "tuple")
					out.push(T.union([...u.elems.map((_, i) => T.tupleElemOf(u, i)), T.UNDEFINED]));
				else if (u.k === "list") out.push(T.union([T.elemOf(u), T.UNDEFINED]));
				else out.push(T.union([T.STRING, T.UNDEFINED]));
			} else if (u.k === "dict") {
				if (!T.isStringish(kt)) {
					this.error(
						"index-type",
						e.property,
						`a dictionary is indexed by a string; ${this.describe(e.property)} is ${this.show(kt)}`,
					);
					return T.UNKNOWN;
				}
				out.push(T.union([T.dictValueOf(u), T.UNDEFINED]));
			} else if (u.k === "record") {
				this.error(
					"record-computed-key",
					e,
					`${this.describe(e.object)} is a record: read its fields by name, or make it a dictionary`,
				);
				return T.UNKNOWN;
			} else {
				this.error(
					"index-type",
					e,
					`${this.describe(e.object)} is ${this.show(u)}, which can't be indexed`,
				);
				return T.UNKNOWN;
			}
		}
		return T.union(out);
	}

	// Calls: of a host function (or callable module), of a module's member, of a method of a
	// list, string or number (tables.js), of a record's or handle's method.
	call(e, env) {
		const callee = e.callee;
		let target = null;
		let short = false;
		if (
			callee.type === "MemberExpression" &&
			!callee.computed &&
			MODULE_ONLY.has(callee.property.name) &&
			!this.isModule(callee.object)
		) {
			this.error(
				"reserved-name",
				callee.property,
				`only a module's member may be called ${callee.property.name}`,
			);
			return { t: T.NEVER, short: false };
		}
		if (callee.type === "MemberExpression" && !callee.computed) {
			const { t: recv0, short: s0 } = this.object(callee.object, env);
			let recv = recv0;
			short = s0;
			if (callee.optional) {
				if (T.hasNullish(recv)) short = true;
				recv = T.removeNullish(recv);
			}
			target = this.method(callee, recv);
		} else if (callee.type === "Identifier") {
			const b = this.scope.lookup(callee.name);
			const t = this.expr(callee, env, null);
			if (t.k === "fn")
				target = {
					sigs: t.sigs,
					bindings: new Map(),
					qualified: b?.qualified ?? callee.name,
					describe: callee.name,
					fresh: b?.fresh ?? false,
					mutParams: b?.mutParams ?? null,
				};
			else if (t.k === "module") {
				const b = this.host.binding(callee.name);
				if (b.call !== null)
					target = {
						sigs: b.call.sigs,
						bindings: new Map(),
						qualified: callee.name,
						describe: callee.name,
					};
				else
					this.error(
						"not-callable",
						callee,
						`the module ${callee.name} can't be called: call one of its members`,
					);
			} else if (t.k !== "unknown")
				this.error("not-callable", callee, `${callee.name} is ${this.show(t)}, not a function`);
		} else {
			this.expr(callee, env, null);
			this.error(
				"not-callable",
				callee,
				"only functions the host provides and methods can be called",
			);
		}
		if (target === null) {
			for (const a of e.arguments)
				if (a.type !== "ArrowFunctionExpression")
					this.quietly(() => this.value(a.type === "SpreadElement" ? a.argument : a, env, null));
			return { t: T.NEVER, short };
		}
		if (this.deterministic && this.host.nondeterministic.has(target.qualified)) {
			this.error(
				"nondeterministic-call",
				callee,
				`${target.qualified} depends on more than its arguments, and the check asks for a deterministic program`,
			);
		}
		const result = this.applySigs(e, target, env);
		// What the program may change after the call.
		let t = result;
		if (target.row?.self) t = target.receiver;
		else if (target.fresh) t = T.withMut(result, true);
		else if (target.row?.fresh || this.host.fresh.has(target.qualified)) t = this.fresh(result);
		else if (target.row === undefined) t = T.withMut(result, false);
		// A call may change what it is given that may change, and its receiver.
		if (
			target.receiverKey !== undefined &&
			(target.row?.mutates ||
				(target.row === undefined && target.receiver && this.topMut(target.receiver)))
		) {
			env.forgetUnder(target.receiverKey);
		}
		if (target.row === undefined) {
			for (const a of e.arguments)
				env.forgetUnder(this.pathKey(a.type === "SpreadElement" ? a.argument : a));
		}
		return { t, short };
	}
	isModule(e) {
		return (
			e.type === "Identifier" &&
			this.scope.lookup(e.name) === null &&
			this.host.binding(e.name)?.kind === "module"
		);
	}
	fresh(t) {
		return T.isContainer(t) ? { ...t, mut: true, deep: false } : t;
	}
	// Whether a value may be changed all the way down, as a parameter that isn't Readonly may be.
	mayChange(t0) {
		const seen = new Set();
		const go = (t) => {
			if (t.k === "union") return t.types.every(go);
			if (t.k === "ref") {
				if (seen.has(t.name)) return true;
				seen.add(t.name);
				const r = this.resolve(t);
				// An alias of a union is its members; one of what isn't a container can't change.
				if (r.k === "union") return go(r);
				if (!t.mut) return !T.isContainer(r) && r.k !== "handle";
				return go(r);
			}
			if (!T.isContainer(t)) return true;
			if (!t.mut) return false;
			if (t.deep) return true;
			switch (t.k) {
				case "list":
					return go(t.elem);
				case "tuple":
					return t.elems.every(go);
				case "dict":
					return go(t.value);
				case "record":
					return Object.values(t.fields).every((f) => go(f.type));
			}
			return true;
		};
		return go(t0);
	}
	method(callee, recv0) {
		const name = callee.property.name;
		const describe = `${this.describe(callee.object)}.${name}`;
		const receiverKey = this.pathKey(callee.object);
		if (recv0.k === "module") {
			const m = this.host.member(recv0.name, name);
			if (m === null) {
				this.error("unknown-member", callee.property, `the module ${recv0.name} has no ${name}`);
				return null;
			}
			if (m.ty.k !== "fn") {
				this.error(
					"not-callable",
					callee,
					`${recv0.name}.${name} is ${this.show(m.ty)}, not a function`,
				);
				return null;
			}
			return { sigs: m.ty.sigs, bindings: new Map(), qualified: m.qualified, describe };
		}
		if (MODULE_ONLY.has(name)) {
			this.error("reserved-name", callee.property, `only a module's member may be called ${name}`);
			return null;
		}
		let recv = this.expand(recv0);
		if (T.hasNullish(recv)) {
			this.error(
				"possibly-null",
				callee.object,
				`${this.describe(callee.object)} may be ${this.show(T.filterUnion(recv, T.isNullish))}: check it first, or use ?.`,
			);
			recv = T.removeNullish(recv);
		}
		if (recv.k === "union") {
			const kinds = new Set(recv.types.map((u) => this.receiverKind(this.resolve(u))));
			if (kinds.size === 1 && kinds.has("string")) recv = T.STRING;
			else if (kinds.size === 1 && kinds.has("number")) recv = T.NUMBER;
			else {
				this.error(
					"method-on-union",
					callee,
					`${this.describe(callee.object)} is ${this.show(recv)}: narrow it to one kind before calling ${name}`,
				);
				return null;
			}
		}
		const r = this.resolve(recv);
		if (r.k === "never") return null;
		const kind = this.receiverKind(r);
		if (kind !== null) {
			const row = methodTables[kind][name];
			if (row === undefined) {
				this.error(
					"unknown-method",
					callee.property,
					`${kind === "list" ? "a list" : `a ${kind}`} has no method ${name} in pure-js`,
				);
				return null;
			}
			const elem =
				kind === "list"
					? r.k === "tuple"
						? T.union(r.elems.map((_, i) => T.tupleElemOf(r, i)))
						: T.elemOf(r)
					: T.UNKNOWN;
			if (row.mutates && !r.mut) {
				this.error(
					"immutable-target",
					callee,
					`${name} changes ${this.describe(callee.object)}, which is read-only here`,
					this.readOnlyHelp(callee.object),
				);
			}
			if (row.primitive && !T.isPrimitive(elem)) {
				this.error(
					"operand-type",
					callee,
					`${name} converts the elements to strings; ${this.describe(callee.object)} holds ${this.show(elem)}`,
				);
			}
			return {
				sigs: row.sigs,
				bindings: new Map([["T", elem]]),
				qualified: `${kind}.${name}`,
				row,
				receiver: r,
				receiverKey,
				receiverNode: callee.object,
				describe,
			};
		}
		if (r.k === "record" || r.k === "handle") {
			if (r.entries?.has(name)) {
				this.error(
					"entry-access",
					callee.property,
					`${describe} is an entry the embedder calls, not something code calls: move what both need to a function`,
				);
				return null;
			}
			const sigs = r.methods[name];
			if (sigs === undefined) {
				if (r.fields[name] !== undefined)
					this.error("not-callable", callee, `${describe} is a field, not a method`);
				else this.error("unknown-method", callee.property, `${this.show(r)} has no method ${name}`);
				return null;
			}
			return {
				sigs,
				bindings: new Map(),
				qualified: `${r.name ?? "record"}.${name}`,
				receiver: r,
				receiverKey,
				describe,
			};
		}
		if (r.k === "unknown") {
			this.error(
				"unknown-member",
				callee,
				`nothing is known of ${this.describe(callee.object)} (it is unknown): narrow it first`,
			);
			return null;
		}
		this.error("unknown-method", callee.property, `${this.show(r)} has no method ${name}`);
		return null;
	}
	readOnlyHelp(node) {
		const key = this.pathKey(node);
		if (!key?.startsWith("this")) return null;
		return this.draftName === null
			? "this is read-only"
			: `this is read-only: change ${key.replace(/^this/, this.draftName)} instead`;
	}
	// The result of calling target with e's arguments: the first overload they fit.
	applySigs(e, target, env) {
		const { sigs } = target;
		if (sigs.length === 1) {
			const bindings = new Map(target.bindings);
			return this.applySig(e, sigs[0], bindings, env, target);
		}
		for (const s of sigs) {
			const attempt = env.copy();
			const bindings = new Map(target.bindings);
			const { failed } = this.quietly(() => this.applySig(e, s, bindings, attempt, target));
			// Run it again keeping what it found (it reported nothing).
			if (!failed) return this.applySig(e, s, new Map(target.bindings), env, target);
		}
		const shown = sigs.map((s) => `  ${T.sigToString(s)}`).join("\n");
		this.error(
			"no-matching-overload",
			e,
			`${target.describe} takes its arguments as one of:\n${shown}`,
		);
		return T.NEVER;
	}
	applySig(e, s, bindings, env, target) {
		const params = s.params;
		const restAt = params.findIndex((p) => p.rest);
		const required = params.filter((p) => !p.optional && !p.rest).length;
		const args = e.arguments;
		const paramFor = (i) => (restAt !== -1 && i >= restAt ? params[restAt] : (params[i] ?? null));
		const hasSpread = args.some((a) => a.type === "SpreadElement");
		if (args.length < required && !hasSpread) {
			this.error(
				"wrong-arity",
				e,
				`${target.describe} takes ${required === params.length ? "" : "at least "}${required} argument${required === 1 ? "" : "s"}, here ${args.length}`,
			);
		}
		if (restAt === -1 && args.length > params.length) {
			this.error(
				"wrong-arity",
				e,
				`${target.describe} takes at most ${params.length} argument${params.length === 1 ? "" : "s"}, here ${args.length}`,
			);
		}
		const rel = this.rel(bindings);
		const expectedOf = (p) => {
			const pt = p.rest ? T.elemOf(this.resolve(p.type)) : p.type;
			return T.subst(pt, bindings);
		};
		const arrows = [];
		args.forEach((a, i) => {
			const p = paramFor(i);
			if (p === null) return;
			if (a.type === "ArrowFunctionExpression") {
				arrows.push([a, p]);
				return;
			}
			if (a.type === "SpreadElement") {
				const st = this.resolve(this.value(a.argument, env, null));
				if (!p.rest) {
					this.error(
						"spread-type",
						a,
						`a spread argument goes in a rest parameter; ${target.describe}'s parameter ${p.name} isn't one`,
					);
					return;
				}
				const elem =
					st.k === "list"
						? T.elemOf(st)
						: st.k === "tuple"
							? T.union(st.elems.map((_, j) => T.tupleElemOf(st, j)))
							: null;
				if (elem === null) {
					this.error(
						"spread-type",
						a,
						`only a list can be spread; ${this.describe(a.argument)} is ${this.show(st)}`,
					);
					return;
				}
				const pt = T.elemOf(this.resolve(p.type));
				if (!rel.assignable(elem, pt))
					this.error(
						"argument-type",
						a,
						`${this.describe(a.argument)} holds ${this.show(elem)}, where ${p.name} takes ${this.show(T.subst(pt, bindings))}`,
					);
				return;
			}
			const exp = expectedOf(p);
			const t = this.value(a, env, T.hasVars(exp) ? null : exp);
			if (target.mutParams?.has(p.name) && !this.mayChange(t))
				this.error(
					"immutable-argument",
					a,
					`${target.describe} may change its parameter ${p.name}, and ${this.describe(a)} is read-only here`,
					`declare the parameter Readonly<...> if ${target.describe} doesn't change it`,
				);
			const pt = p.rest ? T.elemOf(this.resolve(p.type)) : p.type;
			if (!rel.assignable(t, pt)) {
				this.error(
					"argument-type",
					a,
					`${p.name} of ${target.describe} takes ${this.show(T.subst(pt, bindings))}; ${this.describe(a)} is ${this.show(t)}`,
				);
			}
		});
		for (const [a, p] of arrows) {
			const ft = this.resolve(T.subst(p.type, bindings));
			if (ft.k !== "fn" || ft.sigs.length !== 1) {
				this.error(
					"argument-type",
					a,
					`${p.name} of ${target.describe} takes ${this.show(ft)}, not a function`,
				);
				continue;
			}
			const cbSig = ft.sigs[0];
			const result = this.arrow(a, cbSig, env, target, p.type.k === "fn" ? p.type.sigs[0] : null);
			// The callback's own result: bind what it says, then check against it.
			const original = p.type.k === "fn" ? p.type.sigs[0].result : cbSig.result;
			if (!rel.assignable(result, original)) {
				this.error(
					"argument-type",
					a.body,
					`the callback must return ${this.show(T.subst(original, bindings))}; it returns ${this.show(result)}`,
				);
			}
		}
		return T.ground(T.subst(s.result, bindings));
	}
	// A callback; its parameters that are the receiver's elements (T in the method's signature)
	// are of the receiver's mode, a draft's elements drafts at its place.
	arrow(a, cbSig, env, target, declared = null) {
		const receiverMode = target.receiverNode ? this.modeOf(target.receiverNode) : null;
		const receiverPlace = receiverMode === "draft" ? this.placeOf(target.receiverNode) : null;
		if (a.params.length > cbSig.params.length) {
			this.error(
				"callback-arity",
				a,
				`${target.describe} gives its callback ${cbSig.params.length} argument${cbSig.params.length === 1 ? "" : "s"}; this one takes ${a.params.length}`,
			);
		}
		// Inside a callback, what was known of properties is not: TypeScript forgets it, as the
		// callback could run when they have changed. What was known of names stays.
		const inner = env.copy();
		for (const k of [...inner.refine.keys()])
			if (k.includes(".") || k === "this") inner.refine.delete(k);
		this.pushScope();
		a.params.forEach((param, i) => {
			const p = cbSig.params[i];
			let type = p === undefined ? T.UNKNOWN : p.type;
			if (T.hasVars(type)) {
				this.error(
					"callback-type",
					param,
					`the type of ${param.type === "Identifier" ? param.name : "this parameter"} can't be inferred here: annotate it`,
				);
				type = T.UNKNOWN;
			}
			if (param.typeAnnotation) {
				const ann = this.annotation(param.typeAnnotation, this.topMut(type));
				if (!this.assignable(type, ann))
					this.error(
						"param-type",
						param.typeAnnotation,
						`${target.describe} gives ${this.show(type)} here, not ${this.show(ann)}`,
					);
				type = ann;
			}
			const dp = declared?.params[i]?.type;
			const element = dp?.k === "var" && dp.name === "T" && receiverMode === "draft";
			this.bindPattern(
				param,
				type,
				"callback",
				element ? "draft" : null,
				element && receiverPlace !== null ? `${receiverPlace}[*]` : null,
			);
		});
		const expected = T.hasVars(cbSig.result) || cbSig.result.k === "unknown" ? null : cbSig.result;
		const t = a.expression
			? this.value(a.body, inner, expected)
			: this.blockCallback(a, inner, expected);
		this.popScope();
		// What the callback may have changed through calls is forgotten outside too.
		const changes = this.callbackChanges(a);
		for (const [k, v] of [...env.refine]) {
			const property = k.includes(".") || k === "this";
			if (property ? changes : inner.refine.get(k) !== v) env.refine.delete(k);
		}
		return t;
	}
	// A callback with a block body: its returns are its own, its loops too.
	blockCallback(a, env, expected) {
		const saved = {
			returns: this.returns,
			returnModes: this.returnModes,
			returnTypes: this.returnTypes,
			expectedReturn: this.expectedReturn,
			loops: this.loops,
		};
		this.returns = [];
		this.returnModes = [];
		this.returnTypes = [];
		this.expectedReturn = expected;
		this.loops = [];
		const completes = this.statements(a.body.body, env) !== null;
		let t;
		if (expected !== null) {
			if (completes && expected.k !== "void" && !this.assignable(T.UNDEFINED, expected))
				this.error(
					"missing-return",
					a.body,
					`the callback must return ${this.show(expected)} on every path`,
				);
			t = expected;
		} else if (this.returns.length === 0) t = T.UNDEFINED;
		else t = T.union([...this.returns.map(T.widen), ...(completes ? [T.UNDEFINED] : [])]);
		this.returns = saved.returns;
		this.returnModes = saved.returnModes;
		this.returnTypes = saved.returnTypes;
		this.expectedReturn = saved.expectedReturn;
		this.loops = saved.loops;
		return t;
	}
	// Whether a callback calls anything that may change a value: a mutating method, a host
	// function given a value.
	callbackChanges(a) {
		let changes = false;
		const visit = (n) => {
			if (n === null || typeof n !== "object" || changes) return;
			if (Array.isArray(n)) return n.forEach(visit);
			if (n.type === "CallExpression") {
				const c = n.callee;
				if (c.type === "MemberExpression" && !c.computed) {
					const row = methodTables.list[c.property.name];
					if (row?.mutates || row === undefined) changes = true;
				} else changes = true;
			}
			for (const k of Object.keys(n)) if (k !== "type") visit(n[k]);
		};
		visit(a.body);
		return changes;
	}

	// Literals: fresh values, which the program may change; their elements are what they were
	// given. An expected type flows into them.
	arrayLiteral(e, env, expected0) {
		const expected = expected0 === null ? null : this.resolve(T.removeNullish(expected0));
		if (expected?.k === "tuple" && !e.elements.some((x) => x?.type === "SpreadElement")) {
			const elems = e.elements.map((x, i) =>
				x === null
					? T.UNDEFINED
					: this.value(x, env, i < expected.elems.length ? T.tupleElemOf(expected, i) : null),
			);
			return T.tuple(elems, true, false);
		}
		const expElem = expected?.k === "list" ? T.elemOf(expected) : null;
		const parts = [];
		for (const x of e.elements) {
			if (x === null) continue;
			if (x.type === "SpreadElement") {
				const st = this.resolve(this.value(x.argument, env, null));
				if (st.k === "list") parts.push(T.elemOf(st));
				else if (st.k === "tuple") parts.push(...st.elems.map((_, i) => T.tupleElemOf(st, i)));
				else
					this.error(
						"spread-type",
						x,
						`only a list can be spread into a list; ${this.describe(x.argument)} is ${this.show(st)}`,
					);
				if (expElem !== null && (st.k === "list" || st.k === "tuple")) {
					const held =
						st.k === "list" ? T.elemOf(st) : T.union(st.elems.map((_, i) => T.tupleElemOf(st, i)));
					if (!this.assignable(held, expElem))
						this.error(
							"not-assignable",
							x,
							`${this.describe(x.argument)} holds ${this.show(held)}, where ${this.show(expElem)} is expected`,
						);
				}
				continue;
			}
			// What the list is said to hold is what each element must be.
			parts.push(expElem === null ? this.value(x, env, null) : this.checked(x, env, expElem));
		}
		if (expElem !== null) return T.list(expElem, true, false);
		if (parts.length === 0) {
			this.error(
				"empty-array-type",
				e,
				"nothing says what this empty list holds: annotate it, const xs: string[] = [];",
			);
			return T.list(T.UNKNOWN, true, false);
		}
		return T.list(T.union(parts.map(T.widen)), true, false);
	}
	objectLiteral(e, env, expected0) {
		const expected = expected0 === null ? null : this.resolve(T.removeNullish(expected0));
		const expRecord = expected?.k === "record" ? expected : null;
		const expDict = expected?.k === "dict" ? expected : null;
		const fields = {};
		let dictValues = null;
		const seen = new Set();
		for (const p of e.properties) {
			if (p.type === "SpreadElement") {
				const st = this.resolve(this.value(p.argument, env, null));
				if (st.k === "record") {
					for (const [n, f] of Object.entries(st.fields))
						fields[n] = { type: T.fieldTypeOf(st, f), optional: f.optional, readonly: false };
				} else if (st.k === "dict") {
					dictValues = [...(dictValues ?? []), T.dictValueOf(st)];
				} else
					this.error(
						"spread-type",
						p,
						`only a record or a dictionary can be spread into an object; ${this.describe(p.argument)} is ${this.show(st)}`,
					);
				continue;
			}
			if (p.computed) {
				this.value(p.value, env, null);
				continue;
			}
			const name = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			if (seen.has(name)) this.error("duplicate-key", p.key, `${name} is given twice`);
			seen.add(name);
			let fexp = null;
			if (expRecord !== null) {
				const f = expRecord.fields[name];
				if (f === undefined) {
					this.error("excess-property", p.key, `${this.show(expRecord)} has no field ${name}`);
				} else fexp = T.fieldTypeOf(expRecord, f);
			} else if (expDict !== null) fexp = T.dictValueOf(expDict);
			const t = this.value(p.value, env, fexp);
			if (fexp !== null && !this.assignable(t, fexp)) {
				this.error(
					"not-assignable",
					p.value,
					`${name} is ${this.show(fexp)}; this is ${this.show(t)}`,
				);
			}
			fields[name] = { type: fexp !== null ? fexp : T.widen(t), optional: false, readonly: false };
		}
		if (expRecord !== null) {
			const missing = Object.entries(expRecord.fields)
				.filter(([n, f]) => !f.optional && fields[n] === undefined)
				.map(([n]) => n);
			if (missing.length > 0)
				this.error("missing-property", e, `${this.show(expRecord)} needs ${missing.join(", ")}`);
		}
		if (dictValues !== null || expDict !== null) {
			const values = [...(dictValues ?? []), ...Object.values(fields).map((f) => f.type)];
			return T.dict(
				expDict !== null
					? T.dictValueOf(expDict)
					: T.union(values.length === 0 ? [T.UNKNOWN] : values),
				true,
				false,
			);
		}
		if (
			expRecord !== null &&
			expRecord.name !== null &&
			Object.keys(fields).every((n) => expRecord.fields[n] !== undefined)
		) {
			return { ...expRecord, mut: true, deep: true };
		}
		return T.record(null, fields, {}, true, false);
	}

	// x = v, x += v: x a let; after it, x is known to hold v.
	assignName(e, env) {
		const name = e.left.name;
		const b = this.scope.lookup(name);
		if (b === null || b.kind !== "let") {
			const right = this.value(e.right, env, null);
			void right;
			if (b !== null || this.host.binding(name) === null)
				this.error(
					b === null ? "unknown-name" : "const-assignment",
					e.left,
					b === null
						? `${name} is not a parameter, a const or something the host provides`
						: `${name} is a ${b.kind === "param" ? "parameter" : b.kind}: only a let is assigned to`,
				);
			else
				this.error("const-assignment", e.left, `${name} is the host's: only a let is assigned to`);
			return;
		}
		const right = this.value(e.right, env, b.type);
		if (e.operator === "=") {
			if (!this.assignable(right, b.type))
				this.error(
					"not-assignable",
					e.right,
					`${name} is ${this.show(b.type)}; this is ${this.show(right)}`,
				);
		} else {
			const cur = env.refine.get(name) ?? b.type;
			const numeric = T.isNumberish(cur) && T.isNumberish(right);
			const strings = e.operator === "+=" && T.isStringish(cur) && T.isStringish(right);
			if (!numeric && !strings)
				this.error(
					"operand-type",
					e,
					`${e.operator} takes ${e.operator === "+=" ? "two numbers or two strings" : "two numbers"}; here ${this.show(cur)} and ${this.show(right)}`,
				);
		}
		env.forgetUnder(name);
		env.refine.set(name, e.operator === "=" ? right : T.widen(b.type));
		this.record(e.left, b.type, b.mode);
	}
	// Assignments: to a field of a record, an element of a list, a key of a dictionary, all of
	// them mutable. After it, the place is known to hold what was assigned.
	assignment(e, env) {
		const left = e.left;
		if (left.type === "Identifier") return this.assignName(e, env);
		if (left.type !== "MemberExpression") {
			this.value(e.right, env, null);
			return;
		}
		const { t: objT0 } = this.object(left.object, env);
		let objT = objT0;
		if (T.hasNullish(objT)) {
			this.error(
				"possibly-null",
				left.object,
				`${this.describe(left.object)} may be ${this.show(T.filterUnion(objT, T.isNullish))}: check it first`,
			);
			objT = T.removeNullish(objT);
		}
		const o = this.resolve(objT.k === "union" ? objT.types[0] : objT);
		const where = this.describe(left.object);
		let placeT = T.UNKNOWN;
		let ok = true;
		if (left.computed) {
			const kt = this.value(left.property, env, null);
			if (o.k === "list") {
				if (!T.isNumberish(kt))
					this.error(
						"index-type",
						left.property,
						`a list is indexed by a number; ${this.describe(left.property)} is ${this.show(kt)}`,
					);
				placeT = T.elemOf(o);
			} else if (o.k === "dict") {
				if (!T.isStringish(kt))
					this.error(
						"index-type",
						left.property,
						`a dictionary is indexed by a string; ${this.describe(left.property)} is ${this.show(kt)}`,
					);
				placeT = T.dictValueOf(o);
			} else if (o.k === "record") {
				this.error("record-computed-key", left, `${where} is a record: set its fields by name`);
				ok = false;
			} else {
				this.error("immutable-target", left, `${where} is ${this.show(o)}, which can't be changed`);
				ok = false;
			}
		} else {
			const name = left.property.name;
			if (o.k === "record") {
				const f = o.fields[name];
				if (f === undefined) {
					this.error("unknown-property", left.property, `${this.show(o)} has no field ${name}`);
					ok = false;
				} else if (f.readonly) {
					this.error("readonly-property", left.property, `${name} is read-only`);
					ok = false;
				} else placeT = T.fieldTypeOf(o, f);
			} else if (o.k === "dict") {
				this.error(
					"dict-dot-access",
					left.property,
					`${where} is a dictionary: set it as ${where}[${JSON.stringify(name)}]`,
				);
				ok = false;
			} else if (o.k === "unknown") {
				this.error("unknown-member", left, `nothing is known of ${where} (it is unknown)`);
				ok = false;
			} else {
				this.error(
					"immutable-target",
					left,
					`${where} is ${this.show(o)}, whose properties can't be set`,
				);
				ok = false;
			}
		}
		if (ok && T.isContainer(o) && !o.mut) {
			this.error(
				"immutable-target",
				left,
				`${where} is read-only here`,
				this.readOnlyHelp(left.object),
			);
		}
		const right = this.value(e.right, env, ok ? placeT : null);
		if (e.operator === "=") {
			if (ok && !this.assignable(right, placeT))
				this.error(
					"not-assignable",
					e.right,
					`${this.describe(left)} is ${this.show(placeT)}; this is ${this.show(right)}`,
				);
		} else {
			const numeric = T.isNumberish(placeT) && T.isNumberish(right);
			const strings = e.operator === "+=" && T.isStringish(placeT) && T.isStringish(right);
			if (ok && !numeric && !strings)
				this.error(
					"operand-type",
					e,
					`${e.operator} takes ${e.operator === "+=" ? "two numbers or two strings" : "two numbers"}; here ${this.show(placeT)} and ${this.show(right)}`,
				);
		}
		const key = this.pathKey(left);
		if (key !== null) {
			env.forgetUnder(key);
			env.refine.set(key, e.operator === "=" ? right : T.widen(placeT));
		} else env.forgetUnder(this.pathKey(left.object));
	}
}

// Checks a program against a host and an entry signature ({ this, params, result }, each a
// type or read(type)/draft(type)): { diagnostics, returnType }, returnType the type it
// returns (inferred when nothing says it) as TypeScript text.
export const check = (program, { host, signature = null, deterministic = false } = {}) => {
	if (!(host instanceof Host)) throw new TypeError("check needs a host: new Host(...) or stdHost");
	const c = new Checker(program, { host, signature, deterministic });
	const ret = c.run();
	return { diagnostics: c.diagnostics, returnType: T.typeToString(ret), returnTy: ret };
};
