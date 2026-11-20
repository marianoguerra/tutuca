// The interpreter: runs a checked program by walking its tree, for hosts that can't compile
// (a strict content security policy) and as the executable form of the semantics, the one the
// MoonBit port follows. It counts steps and callback depth, both deterministic, and ends a run
// that goes past them as undefined. Built-in methods are JavaScript's own, given callbacks that
// run in the interpreter, so a run means what the compiled function means.

import { itemDeclaration } from "./ast.js";
import { parseModule } from "./parse.js";
import { finished, freeze, get, outcomeOf, PureLimit, PureUndefined, set } from "./runtime.js";
import { RESERVED_NAMES } from "./tables.js";

const RESERVED = new Set(RESERVED_NAMES);
const SHORT = Symbol("short-circuit");
const NAMESPACE = Symbol("namespace");

class Frame {
	constructor(parent) {
		this.parent = parent;
		this.vars = new Map();
	}
	lookup(name) {
		for (let f = this; f !== null; f = f.parent) if (f.vars.has(name)) return f;
		return null;
	}
}
class Return {
	constructor(value) {
		this.value = value;
	}
}
const BREAK = Object.freeze({ signal: "break" });
const CONTINUE = Object.freeze({ signal: "continue" });
// A module's function, as a name refers to it: called, never a value.
class Helper {
	constructor(node, frame) {
		this.node = node;
		this.frame = frame;
	}
}

const isNamespace = (e) =>
	e?.type === "ObjectExpression" &&
	e.properties.some(
		(p) => p.type === "Property" && (p.method || p.kind === "get" || isNamespace(p.value)),
	);

class Interpreter {
	constructor(host, { maxSteps, maxDepth }) {
		this.host = host;
		this.maxSteps = maxSteps;
		this.maxDepth = maxDepth;
		this.steps = 0;
		this.depth = 0;
		this.hostValues = new Map();
	}
	step() {
		if (++this.steps > this.maxSteps) throw new PureLimit(`more than ${this.maxSteps} steps`);
	}
	hostValue(name) {
		if (!this.hostValues.has(name)) this.hostValues.set(name, this.host.value(name));
		return this.hostValues.get(name);
	}
	bind(frame, pattern, value) {
		if (pattern === null) return;
		switch (pattern.type) {
			case "Identifier":
				frame.vars.set(pattern.name, value);
				return;
			case "ArrayPattern": {
				const items = [...value]; // what destructuring an array does: iterate it
				pattern.elements.forEach((e, i) => {
					if (e !== null && e.type === "RestElement") this.bind(frame, e.argument, items.slice(i));
					else this.bind(frame, e, items[i]);
				});
				return;
			}
			case "ObjectPattern": {
				if (value === null || value === undefined)
					throw new TypeError(`Cannot destructure '${value}' as it is ${value}.`);
				const taken = new Set();
				for (const p of pattern.properties) {
					if (p.type === "RestElement") {
						const rest = {};
						for (const k of Object.keys(value)) if (!taken.has(k)) rest[k] = value[k];
						this.bind(frame, p.argument, rest);
						continue;
					}
					const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
					taken.add(key);
					this.bind(frame, p.value, this.read(value, key));
				}
				return;
			}
			case "AssignmentPattern":
				this.bind(
					frame,
					pattern.left,
					value === undefined ? this.expr(pattern.right, frame) : value,
				);
				return;
		}
		throw new PureUndefined(`binding a ${pattern.type}`);
	}
	callFunction(fn, thisValue, args, parent) {
		const frame = new Frame(parent);
		frame.thisValue = thisValue;
		fn.params.forEach((p, i) => {
			this.bind(frame, p, args[i]);
		});
		if (fn.body.type !== "BlockStatement") return this.expr(fn.body, frame);
		const done = this.statements(fn.body.body, frame);
		return done instanceof Return ? done.value : undefined;
	}
	// A module's function called by name: one step, and as deep as callbacks may nest.
	callHelper(h, args) {
		this.step();
		if (++this.depth > this.maxDepth)
			throw new PureLimit(`calls nested more than ${this.maxDepth} deep`);
		try {
			return this.callFunction(h.node, undefined, args, h.frame);
		} finally {
			this.depth--;
		}
	}
	// A module's constant: a frozen value, or a namespace, whose methods and getters run here.
	constant(init, frame) {
		if (!isNamespace(init)) return freeze(this.expr(init, frame));
		const out = {};
		for (const p of init.properties) {
			const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
			if (p.method || p.kind === "get") {
				const interp = this;
				const fn = p.value;
				const entry = function (...args) {
					return interp.callFunction(fn, this, args, frame);
				};
				Object.defineProperty(out, key, {
					[p.kind === "get" ? "get" : "value"]: entry,
					enumerable: true,
					configurable: false,
				});
			} else
				Object.defineProperty(out, key, { value: this.constant(p.value, frame), enumerable: true });
		}
		Object.defineProperty(out, NAMESPACE, { value: true });
		return Object.freeze(out);
	}
	// A callback as a JavaScript function, for the built-in methods to call.
	callback(arrow, frame) {
		return (...args) => {
			if (++this.depth > this.maxDepth)
				throw new PureLimit(`callbacks nested more than ${this.maxDepth} deep`);
			try {
				return this.callFunction(arrow, this.thisOf(frame), args, frame);
			} finally {
				this.depth--;
			}
		};
	}
	thisOf(frame) {
		for (let f = frame; f !== null; f = f.parent) if ("thisValue" in f) return f.thisValue;
		return undefined;
	}
	statements(list, frame) {
		for (const s of list) {
			const r = this.statement(s, frame);
			if (r !== null) return r; // a return, a break or a continue
		}
		return null;
	}
	statement(s, frame) {
		this.step();
		switch (s.type) {
			case "VariableDeclaration":
				for (const d of s.declarations) this.bind(frame, d.id, this.expr(d.init, frame));
				return null;
			case "ExpressionStatement":
				this.expr(s.expression, frame);
				return null;
			case "IfStatement":
				if (this.expr(s.test, frame)) return this.statement(s.consequent, frame);
				return s.alternate === null ? null : this.statement(s.alternate, frame);
			case "BlockStatement":
				return this.statements(s.body, new Frame(frame));
			case "ReturnStatement":
				return new Return(s.argument === null ? undefined : this.expr(s.argument, frame));
			case "ForOfStatement": {
				// The loop walks what the list (or string) held when it began.
				const items = [...this.expr(s.right, frame)];
				const d = s.left.declarations[0];
				for (const item of items) {
					this.step();
					const inner = new Frame(frame);
					this.bind(inner, d.id, item);
					const r = this.statement(s.body, inner);
					if (r === BREAK) break;
					if (r instanceof Return) return r;
				}
				return null;
			}
			case "BreakStatement":
				return BREAK;
			case "ContinueStatement":
				return CONTINUE;
			default:
				throw new PureUndefined(`running a ${s.type}`);
		}
	}
	expr(e, frame) {
		this.step();
		switch (e.type) {
			case "Identifier": {
				const f = frame.lookup(e.name);
				if (f !== null) return f.vars.get(e.name);
				if (e.name === "undefined") return undefined;
				return this.hostValue(e.name);
			}
			case "ThisExpression":
				return this.thisOf(frame);
			case "Literal":
				return e.value;
			case "TemplateLiteral": {
				let out = "";
				e.quasis.forEach((q, i) => {
					out += q.value.cooked;
					if (i < e.expressions.length) out += `${this.expr(e.expressions[i], frame)}`;
				});
				return out;
			}
			case "ArrayExpression": {
				const out = [];
				for (const x of e.elements) {
					if (x.type === "SpreadElement") out.push(...this.expr(x.argument, frame));
					else out.push(this.expr(x, frame));
				}
				return out;
			}
			case "ObjectExpression": {
				const out = {};
				for (const p of e.properties) {
					if (p.type === "SpreadElement") {
						const src = this.expr(p.argument, frame);
						if (src !== null && src !== undefined)
							for (const k of Object.keys(src))
								Object.defineProperty(out, k, {
									value: src[k],
									writable: true,
									enumerable: true,
									configurable: true,
								});
						continue;
					}
					const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
					Object.defineProperty(out, key, {
						value: this.expr(p.value, frame),
						writable: true,
						enumerable: true,
						configurable: true,
					});
				}
				return out;
			}
			case "MemberExpression":
			case "CallExpression": {
				const v = this.link(e, frame);
				return v === SHORT ? undefined : v;
			}
			case "ChainExpression": {
				const v = this.link(e.expression, frame);
				return v === SHORT ? undefined : v;
			}
			case "UnaryExpression": {
				const v = this.expr(e.argument, frame);
				switch (e.operator) {
					case "!":
						return !v;
					case "-":
						return -v;
					case "typeof":
						return typeof v;
				}
				throw new PureUndefined(`the operator ${e.operator}`);
			}
			case "BinaryExpression": {
				const a = this.expr(e.left, frame);
				const b = this.expr(e.right, frame);
				switch (e.operator) {
					case "+":
						return a + b;
					case "-":
						return a - b;
					case "*":
						return a * b;
					case "/":
						return a / b;
					case "%":
						return a % b;
					case "<":
						return a < b;
					case ">":
						return a > b;
					case "<=":
						return a <= b;
					case ">=":
						return a >= b;
					case "===":
						return a === b;
					case "!==":
						return a !== b;
				}
				throw new PureUndefined(`the operator ${e.operator}`);
			}
			case "LogicalExpression": {
				const a = this.expr(e.left, frame);
				if (e.operator === "&&") return a ? this.expr(e.right, frame) : a;
				if (e.operator === "||") return a ? a : this.expr(e.right, frame);
				return a ?? this.expr(e.right, frame);
			}
			case "ConditionalExpression":
				return this.expr(e.test, frame)
					? this.expr(e.consequent, frame)
					: this.expr(e.alternate, frame);
			case "AssignmentExpression":
				return this.assign(e, frame);
		}
		throw new PureUndefined(`running a ${e.type}`);
	}
	// A link of a chain: its value, or SHORT when an optional link short-circuited it.
	object(e, frame) {
		return e.type === "MemberExpression" || e.type === "CallExpression"
			? this.link(e, frame)
			: this.expr(e, frame);
	}
	link(e, frame) {
		if (e.type === "CallExpression") return this.call(e, frame);
		const obj = this.object(e.object, frame);
		if (obj === SHORT) return SHORT;
		if (e.optional && (obj === null || obj === undefined)) return SHORT;
		if (e.computed) return get(obj, this.expr(e.property, frame));
		return this.read(obj, e.property.name);
	}
	read(obj, name) {
		if (RESERVED.has(name)) throw new PureUndefined(`reading the reserved property ${name}`);
		if (obj === null || obj === undefined)
			throw new TypeError(`Cannot read properties of ${obj} (reading '${name}')`);
		return obj[name];
	}
	args(list, frame) {
		const out = [];
		for (const a of list) {
			if (a.type === "SpreadElement") out.push(...this.expr(a.argument, frame));
			else if (a.type === "ArrowFunctionExpression") out.push(this.callback(a, frame));
			else out.push(this.expr(a, frame));
		}
		return out;
	}
	call(e, frame) {
		const callee = e.callee;
		if (callee.type === "MemberExpression" && !callee.computed) {
			const recv = this.object(callee.object, frame);
			if (recv === SHORT) return SHORT;
			if (callee.optional && (recv === null || recv === undefined)) return SHORT;
			const f = this.read(recv, callee.property.name);
			const args = this.args(e.arguments, frame);
			if (typeof f !== "function") throw new TypeError(`${callee.property.name} is not a function`);
			// sort is pure-js's own merge sort, so the comparator is called the same times in the
			// same order on every engine and in every port, and steps count the same.
			if (Array.isArray(recv) && callee.property.name === "sort") return sortInPlace(recv, args[0]);
			return f.apply(recv, args);
		}
		const f = this.expr(callee, frame);
		const args = this.args(e.arguments, frame);
		if (f instanceof Helper) return this.callHelper(f, args);
		if (typeof f !== "function") throw new TypeError("not a function");
		return f(...args);
	}
	assign(e, frame) {
		const left = e.left;
		if (left.type === "Identifier") {
			const f = frame.lookup(left.name);
			if (f === null) throw new PureUndefined(`assigning to ${left.name}`);
			const v = this.expr(e.right, frame);
			const old = f.vars.get(left.name);
			f.vars.set(left.name, e.operator === "=" ? v : e.operator === "+=" ? old + v : old - v);
			return undefined;
		}
		if (left.type !== "MemberExpression") throw new PureUndefined("assigning to a name");
		const obj = this.object(left.object, frame);
		if (left.computed) {
			const key = this.expr(left.property, frame);
			set(obj, key, this.expr(e.right, frame));
			return undefined;
		}
		const name = left.property.name;
		if (RESERVED.has(name)) throw new PureUndefined(`setting the reserved property ${name}`);
		if (obj === null || obj === undefined)
			throw new TypeError(`Cannot set properties of ${obj} (setting '${name}')`);
		if (e.operator === "=") obj[name] = this.expr(e.right, frame);
		else if (e.operator === "+=") obj[name] = obj[name] + this.expr(e.right, frame);
		else obj[name] = obj[name] - this.expr(e.right, frame);
		return undefined;
	}
}

// A stable top-down merge sort: compare(a, b) above 0 puts b first. Frozen lists throw as
// JavaScript's sort does on them.
const mergeSort = (xs, compare) => {
	if (xs.length <= 1) return xs;
	const mid = Math.floor(xs.length / 2);
	const a = mergeSort(xs.slice(0, mid), compare);
	const b = mergeSort(xs.slice(mid), compare);
	const out = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const x = String(a[i]);
		const y = String(b[j]);
		const r = compare === undefined ? (x < y ? -1 : x > y ? 1 : 0) : Number(compare(a[i], b[j]));
		if (r > 0) out.push(b[j++]);
		else out.push(a[i++]);
	}
	while (i < a.length) out.push(a[i++]);
	while (j < b.length) out.push(b[j++]);
	return out;
};
const sortInPlace = (list, compare) => {
	if (Object.isFrozen(list))
		throw new TypeError("Cannot assign to read only property '0' of object '[object Array]'");
	const sorted = mergeSort([...list], compare);
	for (let k = 0; k < sorted.length; k++) list[k] = sorted[k];
	return list;
};

// Runs a checked program (verify it first): its outcome, { kind: "finished", value },
// { kind: "terminated", error, message } or { kind: "undefined", why }.
export const run = (
	program,
	{ host, this: thisValue, args = [], maxSteps = 1_000_000, maxDepth = 1000 } = {},
) => {
	const interp = new Interpreter(host, { maxSteps, maxDepth });
	try {
		return {
			...finished(interp.callFunction(program.function, thisValue, args, null)),
			steps: interp.steps,
		};
	} catch (error) {
		return { ...outcomeOf(error), steps: interp.steps };
	}
};

// A module, made: its constants in the order they're written (each frozen), its helpers, and
// its namespaces, whose entries are functions that run in the interpreter. { ok, namespaces,
// consts, exports, interp }, or { ok: false, outcome } when making a constant fails.
export const instantiate = (
	module,
	{ host, resolve = null, maxSteps = 1_000_000, maxDepth = 1000, cache = new Map() } = {},
) => {
	const interp = new Interpreter(host, { maxSteps, maxDepth });
	const frame = new Frame(null);
	const exports = {};
	const consts = {};
	const namespaces = {};
	try {
		const decls = module.items.map((i) => ({
			d: itemDeclaration(i),
			exported: i.type === "ExportNamedDeclaration",
		}));
		for (const { d } of decls)
			if (d.type === "FunctionDeclaration") frame.vars.set(d.id.name, new Helper(d, frame));
		for (const { d } of decls) {
			if (d.type !== "ImportDeclaration" || d.importKind === "type") continue;
			const spec = d.source.value;
			const hostModule = host.imports.get(spec);
			let from;
			if (hostModule !== undefined) from = interp.hostValue(hostModule);
			else {
				if (!cache.has(spec)) {
					const found = resolve?.(spec);
					const tree = typeof found === "string" ? parseModule(found).module : found;
					const sub = instantiate(tree, { host, resolve, maxSteps, maxDepth, cache });
					if (!sub.ok) return sub;
					cache.set(spec, sub);
				}
				from = cache.get(spec).exports;
			}
			for (const sp of d.specifiers) frame.vars.set(sp.local.name, from[sp.imported.name]);
		}
		for (const { d, exported } of decls) {
			if (d.type === "VariableDeclaration") {
				for (const x of d.declarations) {
					const value = interp.constant(x.init, frame);
					frame.vars.set(x.id.name, value);
					if (value?.[NAMESPACE] === true) namespaces[x.id.name] = value;
					else consts[x.id.name] = value;
					if (exported) exports[x.id.name] = value;
				}
			} else if (d.type === "FunctionDeclaration" && exported)
				exports[d.id.name] = frame.vars.get(d.id.name);
		}
	} catch (error) {
		return { ok: false, outcome: { ...outcomeOf(error), steps: interp.steps } };
	}
	return { ok: true, namespaces, consts, exports, interp };
};

// Runs the entry at path of a made module: its outcome, as run's, with the steps it took.
export const runEntry = (instance, path, { this: thisValue, args = [] } = {}) => {
	const interp = instance.interp;
	interp.steps = 0;
	interp.depth = 0;
	try {
		let holder = instance.namespaces[path[0]];
		for (const name of path.slice(1, -1)) holder = holder[name];
		const name = path.at(-1);
		const d = Object.getOwnPropertyDescriptor(holder, name);
		const value = d.get !== undefined ? d.get.call(thisValue) : d.value.apply(thisValue, args);
		return { ...finished(value), steps: interp.steps };
	} catch (error) {
		return { ...outcomeOf(error), steps: interp.steps };
	}
};

// Calls a compiled program's function with the same outcomes.
export const runCompiled = (fn, { this: thisValue, args = [] } = {}) => {
	try {
		return finished(fn.apply(thisValue, args));
	} catch (error) {
		return outcomeOf(error);
	}
};
