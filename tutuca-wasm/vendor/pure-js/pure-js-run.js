// Runs what pure-js compiled: instantiates a compiled module, gives it the
// few things it asks of its host, and turns JSON into its values and back.
//
//   import { instantiate } from "./pure-js-run.js";
//   const instance = await instantiate(analysis.compiled.bytes, { answers: { "Shop.orderId": "order-1" } });
//   const { outcome, args, calls } = instance.run({ this: cart, args: [draft, ["tea", 2]] });
//
// A compiled module imports the JavaScript string builtins, its string
// constants, and five functions (module "purejs"): fail, number_text,
// to_number, method (a string's or a number's method) and host (a member of
// the host, by qualified name: the standard host's are answered here).

const COMPILE_OPTIONS = { builtins: ["js-string"], importedStringConstants: "'" };

const RESERVED = new Set([
	"constructor",
	"prototype",
	"__proto__",
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"toString",
	"toLocaleString",
	"valueOf",
	"caller",
	"callee",
	"arguments",
]);

// How compiled code ends a run: 0 undefined behaviour (why), 1 an error (its kind, its message).
export class Fail extends Error {
	constructor(kind, a, b) {
		super(kind === 0 ? a : `${a}: ${b}`);
		this.outcome = kind === 0 ? { kind: "undefined", why: a } : { kind: "terminated", error: a, message: b };
	}
}

const typeError = (message) => new Fail(1, "TypeError", message);
const json = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** A compiled module, made: its entries can be run. */
export class Instance {
	#x;
	#answers;
	#host;
	#rawHost;
	#calls = [];
	#made = null;

	constructor(module, { answers = {}, host = {}, rawHost = null } = {}) {
		this.#answers = answers;
		this.#host = host;
		this.#rawHost = rawHost;
		const imports = {
			purejs: {
				fail: (kind, a, b) => {
					throw new Fail(kind, a, b);
				},
				number_text: (x) => String(x),
				to_number: (text) => Number(text),
				method: (name, recv, args) => this.#guard(() => this.#method(name, recv, args)),
				host: (name, self, args) => this.#guard(() => this.#member(name, self, args)),
			},
		};
		this.#x = new WebAssembly.Instance(module, imports).exports;
	}

	/** The module's exports as they are: its entries and the functions that make and read its values. */
	get exports() {
		return this.#x;
	}

	/** The functions an embedder can run: a program's is "main", a module's entries are their paths. */
	get entries() {
		return Object.keys(this.#x).filter((name) => name === "main" || name.includes("."));
	}

	// What JavaScript throws in the host's library ends the run as an error of its kind.
	#guard(f) {
		try {
			return f();
		} catch (e) {
			if (e instanceof Fail) throw e;
			throw new Fail(1, e?.name ?? "Error", e?.message ?? String(e));
		}
	}

	/** A JSON value (or undefined) as a value of the module's. { $handle: name, ...fields } is a handle. */
	toValue(v) {
		const x = this.#x;
		if (v === undefined) return x.v_const(0);
		if (v === null) return x.v_const(1);
		if (typeof v === "boolean") return x.v_const(v ? 3 : 2);
		if (typeof v === "number") return x.v_num(v);
		if (typeof v === "string") return x.v_str(v);
		if (Array.isArray(v)) {
			const list = x.list_new();
			for (const item of v) x.list_add(list, this.toValue(item));
			return list;
		}
		const obj = x.obj_new();
		for (const [k, item] of Object.entries(v)) {
			if (k !== "$handle" && !RESERVED.has(k)) x.obj_put(obj, k, this.toValue(item));
		}
		return typeof v.$handle === "string" ? x.v_handle(v.$handle, obj) : obj;
	}

	/** A value of the module's as JavaScript's: lists are arrays, records and dictionaries objects. */
	fromValue(v) {
		const x = this.#x;
		switch (x.v_kind(v)) {
			case 0:
				return undefined;
			case 1:
				return null;
			case 2:
				return false;
			case 3:
				return true;
			case 4:
				return x.v_num_of(v);
			case 5:
				return x.v_str_of(v);
			case 6: {
				const out = [];
				for (let i = 0; i < x.v_len(v); i++) out.push(this.fromValue(x.v_at(v, i)));
				return out;
			}
			case 7: {
				const out = {};
				for (let i = 0; i < x.v_len(v); i++) out[x.v_key(v, i)] = this.fromValue(x.v_at(v, i));
				return out;
			}
			default:
				return this.fromValue(x.v_handle_fields(v));
		}
	}

	#list(values) {
		const list = this.#x.list_new();
		for (const v of values) this.#x.list_add(list, v);
		return list;
	}

	#items(list) {
		const out = [];
		for (let i = 0; i < this.#x.v_len(list); i++) out.push(this.#x.v_at(list, i));
		return out;
	}

	// The keys and values of a record, a dictionary or a handle's fields, in the order they were set.
	#members(v) {
		const x = this.#x;
		const kind = x.v_kind(v);
		const o = kind === 8 ? x.v_handle_fields(v) : v;
		if (kind !== 7 && kind !== 8) return [];
		const out = [];
		for (let i = 0; i < x.v_len(o); i++) out.push([x.v_key(o, i), x.v_at(o, i)]);
		return out;
	}

	// JavaScript's String(v) of a value.
	#text(v) {
		const x = this.#x;
		const kind = x.v_kind(v);
		if (kind === 6)
			return this.#items(v)
				.map((item) => (x.v_kind(item) < 2 ? "" : this.#text(item)))
				.join(",");
		if (kind >= 7) return "[object Object]";
		return String(this.fromValue(v));
	}

	// JSON.stringify, over the module's values: keys stay in the order they were set.
	#stringify(v, gap, indent = "") {
		const x = this.#x;
		const kind = x.v_kind(v);
		if (kind === 0) return undefined;
		if (kind < 6) return JSON.stringify(this.fromValue(v));
		const inner = indent + gap;
		const wrap = (open, parts, close) => {
			if (parts.length === 0) return open + close;
			return gap === ""
				? open + parts.join(",") + close
				: `${open}\n${inner}${parts.join(`,\n${inner}`)}\n${indent}${close}`;
		};
		if (kind === 6) {
			return wrap(
				"[",
				this.#items(v).map((item) => this.#stringify(item, gap, inner) ?? "null"),
				"]",
			);
		}
		const parts = [];
		for (const [k, item] of this.#members(v)) {
			const text = this.#stringify(item, gap, inner);
			if (text !== undefined) parts.push(`${JSON.stringify(k)}:${gap === "" ? "" : " "}${text}`);
		}
		return wrap("{", parts, "}");
	}

	// A string's or a number's method: JavaScript's own.
	#method(name, recv, args) {
		const self = this.fromValue(recv);
		const f = typeof self === "string" || typeof self === "number" ? self[name] : undefined;
		if (typeof f !== "function" || RESERVED.has(name)) throw typeError(`${name} is not a function`);
		return this.toValue(f.apply(self, this.fromValue(args)));
	}

	// A member of the host: the standard host's, or the embedder's.
	#member(name, self, args) {
		const x = this.#x;
		const values = this.#items(args);
		const arg = (i) => (i < values.length ? values[i] : x.v_const(0));
		const number = (i) => {
			const v = this.fromValue(arg(i));
			return typeof v === "number" ? v : Number(v);
		};
		switch (name) {
			case "Math.max":
			case "Math.min":
			case "Math.abs":
			case "Math.floor":
			case "Math.ceil":
			case "Math.round":
			case "Math.trunc":
			case "Math.sign":
				return x.v_num(Math[name.slice(5)](...values.map((_, i) => number(i))));
			case "Number.isInteger":
			case "Number.isFinite":
			case "Number.isNaN":
				return this.toValue(Number[name.slice(7)](this.fromValue(arg(0))));
			case "Number.parseInt":
				return x.v_num(Number.parseInt(this.#text(arg(0)), number(1)));
			case "Number.parseFloat":
				return x.v_num(Number.parseFloat(this.#text(arg(0))));
			case "JSON.stringify": {
				const space = values.length >= 3 ? Math.max(0, Math.min(10, Math.trunc(number(2)) || 0)) : 0;
				return this.toValue(this.#stringify(arg(0), " ".repeat(space)));
			}
			case "JSON.parse":
				return this.toValue(JSON.parse(this.#text(arg(0))));
			case "Object.keys":
				return this.#list(this.#members(arg(0)).map(([k]) => x.v_str(k)));
			case "Object.entries":
				return this.#list(this.#members(arg(0)).map(([k, v]) => this.#list([x.v_str(k), v])));
			case "Object.fromEntries": {
				if (x.v_kind(arg(0)) !== 6) throw typeError("object is not iterable");
				const out = x.obj_new();
				for (const entry of this.#items(arg(0))) {
					if (x.v_kind(entry) !== 6) throw typeError("Iterator value is not an entry object");
					const [k, v] = this.#items(entry);
					const key = this.#text(k ?? x.v_const(0));
					if (RESERVED.has(key)) throw new Fail(0, `setting the key "${key}"`);
					x.obj_put(out, key, v ?? x.v_const(0));
				}
				return out;
			}
			case "Object.hasOwn": {
				const key = this.#text(arg(1));
				return this.toValue(this.#members(arg(0)).some(([k]) => k === key));
			}
			case "Array.isArray":
				return this.toValue(x.v_kind(arg(0)) === 6);
			case "String":
				return x.v_str(this.#text(arg(0)));
			case "Number":
				return x.v_num(values.length === 0 ? 0 : number(0));
		}
		// An embedder that works on the module's own values answers first: undefined is "not mine".
		if (this.#rawHost !== null) {
			const answer = this.#rawHost(name, self, args);
			if (answer !== undefined) return answer;
		}
		// The embedder's: a function it gave, or the answer it gave, or undefined.
		const given = values.map((v) => json(this.fromValue(v)) ?? null);
		this.#calls.push({ name, args: given });
		if (typeof this.#host[name] === "function") {
			return this.toValue(this.#host[name](json(this.fromValue(self)), ...given));
		}
		return this.toValue(this.#answers[name]);
	}

	#outcome(f) {
		try {
			return { kind: "finished", value: json(this.fromValue(f())) };
		} catch (e) {
			if (e instanceof Fail) return e.outcome;
			// A trap: compiled code met a value its checked types said couldn't be there.
			if (e instanceof WebAssembly.RuntimeError) return { kind: "undefined", why: `trap: ${e.message}` };
			throw e;
		}
	}

	/**
	 * Runs an entry: { entry, this, args }. Gives how it ended, the arguments as it left them and
	 * what it asked of its host. this is frozen, as a host gives what a program only reads.
	 */
	run({ entry = "main", this: self, args = [] } = {}) {
		const x = this.#x;
		this.#calls = [];
		const given = args.map((a) => this.toValue(a));
		const after = () => given.map((v) => json(this.fromValue(v)) ?? null);
		// A module's constants are made once, before its first run; a run can't start if that failed.
		if (this.#made === null) {
			const made = this.#outcome(() => {
				x.init?.();
				return x.v_const(0);
			});
			this.#made = made.kind === "finished" ? true : made;
		}
		if (this.#made !== true) return { outcome: this.#made, args: after(), calls: this.#calls };
		const f = x[entry];
		if (typeof f !== "function" || !this.entries.includes(entry)) {
			const outcome = { kind: "terminated", error: "TypeError", message: `there is no entry ${entry}` };
			return { outcome, args: after(), calls: this.#calls };
		}
		const receiver = self === undefined ? x.v_const(0) : x.freeze(this.toValue(self));
		const params = [];
		for (let i = 0; i < f.length - 1; i++) params.push(i < given.length ? given[i] : x.v_const(0));
		const outcome = this.#outcome(() => f(receiver, ...params));
		if (outcome.kind === "finished" && outcome.value === undefined) delete outcome.value;
		return { outcome, args: after(), calls: this.#calls };
	}
}

/** The bytes pure-js compiled, as a WebAssembly.Module. */
export function compileBytes(bytes) {
	return WebAssembly.compile(bytes, COMPILE_OPTIONS);
}

/**
 * Makes a compiled module: bytes (or a WebAssembly.Module) to an Instance. answers says what the
 * host's members answer by qualified name; host gives functions for them, (this, ...args) => result.
 */
export async function instantiate(bytes, options) {
	const module = bytes instanceof WebAssembly.Module ? bytes : await compileBytes(bytes);
	return new Instance(module, options);
}
