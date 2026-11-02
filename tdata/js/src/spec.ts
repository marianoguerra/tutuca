// Specs (docs/spec.md §4): open matching of the part of a value or message a component needs.
// A spec is a Value: a String names a registered spec, a Typed "tdata.spec/<form>" carries a
// form's arguments in an Object. Keys, dialects, attributes and trailing elements a spec doesn't
// mention are ignored. A malformed spec fails to match with a problem; it never throws.

import { asValue, type Codecs, noCodecs } from "./codecs.ts";
import { equal } from "./equal.ts";
import { decodeMessage as decodeMessageJson, decodeValue as decodeValueJson } from "./json.ts";
import {
	hasMessages,
	Instant,
	isMessage,
	kindOf,
	type Message,
	type Node,
	type Ref,
	Typed,
	type Value,
} from "./model.ts";

export const SPEC_PREFIX = "tdata.spec/";
export const SPECS_KIND = "tdata/specs";

export type Segment = string | bigint;
export type Path = Segment[];
export interface Pick {
	path: Path;
	alt: string;
}
export interface Problem {
	path: Path;
	reason: string;
}
export type CheckResult = { ok: true; picks: Pick[] } | { ok: false; problems: Problem[] };

/** A spec form as a value: Typed("tdata.spec/<form>", Object of arguments). */
export const spec = (form: string, args: Record<string, Value> = {}): Typed =>
	new Typed(SPEC_PREFIX + form, new Map(Object.entries(args)));

const BUILTINS = [
	"any",
	"null",
	"bool",
	"int",
	"double",
	"number",
	"string",
	"bytes",
	"instant",
	"ref",
];

export class Registry {
	#specs = new Map<string, Value>();
	readonly codecs: Codecs;

	constructor(opts: { codecs?: Codecs } = {}) {
		this.codecs = opts.codecs ?? noCodecs;
		for (const name of BUILTINS) this.#specs.set(name, spec(name));
	}

	define(name: string, s: Value): this {
		this.#specs.set(name, s);
		return this;
	}

	get(name: string): Value | undefined {
		return this.#specs.get(name);
	}

	has(name: string): boolean {
		return this.#specs.has(name);
	}

	/** Defines every name → spec of a `tdata/specs` message, or of an Object. */
	load(source: Message | Map<string, Value>): this {
		const m = source instanceof Map ? source : hasMessages(source) ? undefined : source.data;
		if (isMessage(source) && source.kind !== SPECS_KIND)
			throw new TypeError(`a specs message has kind "${SPECS_KIND}", not "${source.kind}"`);
		if (!(m instanceof Map)) throw new TypeError("specs must be an Object of name → spec");
		for (const [name, s] of m) this.define(name, s);
		return this;
	}

	/** Defines specs from the JSON text of a `tdata/specs` message or of an Object. */
	loadJson(text: string): this {
		const t = text.trimStart();
		if (t.startsWith("{") && /^\{\s*"(id|kind)"/.test(t)) return this.load(decodeMessageJson(text));
		const v = decodeValueJson(text);
		if (!(v instanceof Map)) throw new TypeError("specs must be an Object of name → spec");
		return this.load(v);
	}

	check(s: Value, x: Value | Message): CheckResult {
		const ctx = new Ctx(this);
		ctx.match(s, x, []);
		return ctx.problems.length === 0
			? { ok: true, picks: ctx.picks }
			: { ok: false, problems: ctx.problems };
	}

	valid(s: Value, x: Value | Message): boolean {
		return this.check(s, x).ok;
	}
}

// Depth guard for recursive named specs over cyclic-looking data: specs over finite values
// always terminate, but a spec that names itself without consuming input (a = and(a)) doesn't.
const MAX_DEPTH = 512;

class Ctx {
	reg: Registry;
	picks: Pick[] = [];
	problems: Problem[] = [];
	depth = 0;

	constructor(reg: Registry) {
		this.reg = reg;
	}

	problem(path: Path, reason: string): false {
		this.problems.push({ path: [...path], reason });
		return false;
	}

	/** Runs `f` in a scratch context: its picks and problems are kept only if it matched. */
	attempt(f: (c: Ctx) => boolean): { ok: boolean; picks: Pick[]; problems: Problem[] } {
		const c = new Ctx(this.reg);
		c.depth = this.depth;
		const ok = f(c) && c.problems.length === 0;
		return { ok, picks: c.picks, problems: c.problems };
	}

	match(s: Value, x: unknown, path: Path): boolean {
		if (++this.depth > MAX_DEPTH) {
			this.depth--;
			return this.problem(path, "the spec nests too deeply (a spec that refers to itself?)");
		}
		try {
			return this.matchSpec(s, x, path);
		} finally {
			this.depth--;
		}
	}

	matchSpec(s: Value, x: unknown, path: Path): boolean {
		if (typeof s === "string") {
			const named = this.reg.get(s);
			if (named === undefined) return this.problem(path, `unknown spec ${JSON.stringify(s)}`);
			return this.match(named, x, path);
		}
		if (!(s instanceof Typed) || !s.typeId.startsWith(SPEC_PREFIX))
			return this.problem(path, "not a spec (a spec is a name or a tdata.spec/… Typed)");
		const form = s.typeId.slice(SPEC_PREFIX.length);
		const args = s.value;
		if (!(args instanceof Map))
			return this.problem(path, `spec "${form}" needs an Object of arguments`);
		const f = FORMS[form];
		if (!f) return this.problem(path, `unknown spec form "${form}"`);
		// A native is matched through its wire view, so specs mean the same in every implementation.
		return f(this, args, isMessage(x) ? x : (asValue(x, this.reg.codecs) ?? x), path);
	}
}

type Args = Map<string, Value>;
type Form = (c: Ctx, args: Args, x: unknown, path: Path) => boolean;

const arg = (args: Args, k: string): Value | undefined => args.get(k);

const intArg = (c: Ctx, args: Args, k: string, path: Path): bigint | undefined | false => {
	const v = args.get(k);
	if (v === undefined) return undefined;
	if (typeof v !== "bigint") return c.problem(path, `spec argument "${k}" must be an Int`);
	return v;
};

const numArg = (c: Ctx, args: Args, k: string, path: Path): number | bigint | undefined | false => {
	const v = args.get(k);
	if (v === undefined) return undefined;
	if (typeof v !== "bigint" && typeof v !== "number")
		return c.problem(path, `spec argument "${k}" must be a number`);
	return v;
};

/** a < b, for Ints and Doubles mixed (exact for Ints, NaN compares false). */
const lt = (a: number | bigint, b: number | bigint): boolean => {
	if (typeof a === "bigint" && typeof b === "bigint") return a < b;
	if (typeof a === "number" && typeof b === "number") return a < b;
	if (typeof a === "bigint") return cmpIntDouble(a, b as number) < 0;
	return cmpIntDouble(b as bigint, a) > 0;
};

// The sign of i - d, exactly; NaN gives NaN so that both lt directions are false.
const cmpIntDouble = (i: bigint, d: number): number => {
	if (Number.isNaN(d)) return Number.NaN;
	if (d === Infinity) return -1;
	if (d === -Infinity) return 1;
	const fl = Math.floor(d);
	const bi = BigInt(fl);
	if (i < bi) return -1;
	if (i > bi) return 1;
	return d === fl ? 0 : -1;
};

const bounds = (
	c: Ctx,
	args: Args,
	n: number | bigint,
	path: Path,
	lo = "min",
	hi = "max",
	what = "",
): boolean => {
	const min = numArg(c, args, lo, path);
	const max = numArg(c, args, hi, path);
	if (min === false || max === false) return false;
	if (min !== undefined && lt(n, min))
		return c.problem(path, `${what}${n} is below the minimum ${min}`);
	if (max !== undefined && lt(max, n))
		return c.problem(path, `${what}${n} is above the maximum ${max}`);
	return true;
};

const expectKind = (c: Ctx, x: unknown, kind: string, path: Path, label: string): boolean =>
	kindOf(x) === kind ? true : c.problem(path, `expected ${label}, got ${describe(x)}`);

const DESCRIBE: Record<string, string> = {
	null: "Null",
	bool: "a Bool",
	int: "an Int",
	double: "a Double",
	string: "a String",
	bytes: "Bytes",
	instant: "an Instant",
	ref: "a Ref",
	array: "an Array",
	object: "an Object",
	set: "a Set",
	typed: "a Typed",
	node: "a Node",
};

const describe = (x: unknown): string =>
	isMessage(x) ? "a message" : (DESCRIBE[kindOf(x) ?? ""] ?? "something that isn't a value");

const all = (results: boolean[]): boolean => results.every(Boolean);

const elements = (c: Ctx, of: Value | undefined, items: unknown[], path: Path): boolean => {
	if (of === undefined) return true;
	return all(items.map((e, i) => c.match(of, e, [...path, BigInt(i)])));
};

const keysForm: Form = (c, args, x, path) => {
	if (!expectKind(c, x, "object", path, "an Object")) return false;
	return keysOf(c, args, x as Map<string, unknown>, path);
};

const keysOf = (c: Ctx, args: Args, m: Map<string, unknown>, path: Path): boolean => {
	const req = arg(args, "req");
	const opt = arg(args, "opt");
	let ok = true;
	for (const [name, group, required] of [
		["req", req, true],
		["opt", opt, false],
	] as const) {
		if (group === undefined) continue;
		if (!(group instanceof Map)) {
			ok = c.problem(path, `spec argument "${name}" must be an Object of key → spec`);
			continue;
		}
		for (const [k, s] of group) {
			if (!m.has(k)) {
				if (required) ok = c.problem(path, `missing key ${JSON.stringify(k)}`);
				continue;
			}
			if (!c.match(s, m.get(k), [...path, k])) ok = false;
		}
	}
	return ok;
};

const lengthForm =
	(kind: "array" | "set", label: string): Form =>
	(c, args, x, path) => {
		if (!expectKind(c, x, kind, path, label)) return false;
		const items = kind === "set" ? [...(x as Set<unknown>)] : (x as unknown[]);
		const min = intArg(c, args, "min", path);
		const max = intArg(c, args, "max", path);
		if (min === false || max === false) return false;
		const n = BigInt(items.length);
		let ok = true;
		if (min !== undefined && n < min)
			ok = c.problem(path, `${n} elements, fewer than the minimum ${min}`);
		if (max !== undefined && n > max)
			ok = c.problem(path, `${n} elements, more than the maximum ${max}`);
		return elements(c, arg(args, "of"), items, path) && ok;
	};

const numberForm =
	(kinds: string[], label: string): Form =>
	(c, args, x, path) => {
		if (!kinds.includes(kindOf(x) ?? ""))
			return c.problem(path, `expected ${label}, got ${describe(x)}`);
		return bounds(c, args, x as number | bigint, path);
	};

const sizeForm =
	(kind: "string" | "bytes", label: string): Form =>
	(c, args, x, path) => {
		if (!expectKind(c, x, kind, path, label)) return false;
		const n = kind === "string" ? [...(x as string)].length : (x as Uint8Array).length;
		const min = intArg(c, args, "min_len", path);
		const max = intArg(c, args, "max_len", path);
		if (min === false || max === false) return false;
		if (min !== undefined && BigInt(n) < min)
			return c.problem(path, `length ${n} is below the minimum ${min}`);
		if (max !== undefined && BigInt(n) > max)
			return c.problem(path, `length ${n} is above the maximum ${max}`);
		return true;
	};

const stringArg = (c: Ctx, args: Args, k: string, path: Path): string | undefined | false => {
	const v = args.get(k);
	if (v === undefined) return undefined;
	if (typeof v !== "string") return c.problem(path, `spec argument "${k}" must be a String`);
	return v;
};

const listArg = (c: Ctx, args: Args, k: string, path: Path): Value[] | false => {
	const v = args.get(k);
	if (!Array.isArray(v)) return c.problem(path, `spec argument "${k}" must be an Array`);
	return v;
};

const messagesOf = (c: Ctx, args: Args, items: Message[], path: Path): boolean => {
	const min = intArg(c, args, "min", path);
	const max = intArg(c, args, "max", path);
	if (min === false || max === false) return false;
	const n = BigInt(items.length);
	let ok = true;
	if (min !== undefined && n < min)
		ok = c.problem(path, `${n} messages, fewer than the minimum ${min}`);
	if (max !== undefined && n > max)
		ok = c.problem(path, `${n} messages, more than the maximum ${max}`);
	const every = arg(args, "every");
	if (every !== undefined)
		ok = all(items.map((m, i) => c.match(every, m, [...path, BigInt(i)]))) && ok;
	const some = arg(args, "some");
	if (some !== undefined) {
		const hit = items.findIndex((m, i) => {
			const r = c.attempt((sc) => sc.match(some, m, [...path, BigInt(i)]));
			if (r.ok) c.picks.push(...r.picks);
			return r.ok;
		});
		if (hit < 0) ok = c.problem(path, 'no message matched "some"');
	}
	return ok;
};

const FORMS: Record<string, Form> = {
	any: () => true,
	null: (c, _a, x, path) => expectKind(c, x, "null", path, "Null"),
	bool: (c, _a, x, path) => expectKind(c, x, "bool", path, "a Bool"),
	int: numberForm(["int"], "an Int"),
	double: numberForm(["double"], "a Double"),
	number: numberForm(["int", "double"], "a number"),
	string: sizeForm("string", "a String"),
	bytes: sizeForm("bytes", "Bytes"),
	instant: (c, args, x, path) => {
		if (!expectKind(c, x, "instant", path, "an Instant")) return false;
		const ns = (x as Instant).epochNanoseconds;
		for (const [k, below] of [
			["min", true],
			["max", false],
		] as const) {
			const b = args.get(k);
			if (b === undefined) continue;
			if (!(b instanceof Instant))
				return c.problem(path, `spec argument "${k}" must be an Instant`);
			if (below ? ns < b.epochNanoseconds : ns > b.epochNanoseconds)
				return c.problem(path, `the instant is ${below ? "before" : "after"} the ${k}imum`);
		}
		return true;
	},
	ref: (c, args, x, path) => {
		if (!expectKind(c, x, "ref", path, "a Ref")) return false;
		const prefix = stringArg(c, args, "prefix", path);
		if (prefix === false) return false;
		if (prefix !== undefined && !(x as Ref).uri.startsWith(prefix))
			return c.problem(path, `the uri doesn't start with ${JSON.stringify(prefix)}`);
		return true;
	},
	const: (c, args, x, path) => {
		if (!args.has("value")) return c.problem(path, 'spec "const" needs a "value"');
		return equal(args.get("value"), x, c.reg.codecs)
			? true
			: c.problem(path, "not the expected constant");
	},
	enum: (c, args, x, path) => {
		const values = listArg(c, args, "values", path);
		if (values === false) return false;
		return values.some((v) => equal(v, x, c.reg.codecs))
			? true
			: c.problem(path, "not one of the allowed values");
	},
	keys: keysForm,
	map_of: (c, args, x, path) => {
		if (!expectKind(c, x, "object", path, "an Object")) return false;
		const vs = arg(args, "values");
		if (vs === undefined) return c.problem(path, 'spec "map_of" needs "values"');
		return all([...(x as Map<string, unknown>)].map(([k, v]) => c.match(vs, v, [...path, k])));
	},
	array: lengthForm("array", "an Array"),
	set: lengthForm("set", "a Set"),
	tuple: (c, args, x, path) => {
		if (!expectKind(c, x, "array", path, "an Array")) return false;
		const items = listArg(c, args, "items", path);
		if (items === false) return false;
		const xs = x as unknown[];
		if (xs.length < items.length)
			return c.problem(path, `${xs.length} elements, the tuple needs at least ${items.length}`);
		return all(items.map((s, i) => c.match(s, xs[i], [...path, BigInt(i)])));
	},
	typed: (c, args, x, path) => {
		if (!expectKind(c, x, "typed", path, "a Typed")) return false;
		const t = x as Typed<unknown>;
		const typeId = stringArg(c, args, "type_id", path);
		if (typeId === false) return false;
		if (typeId === undefined) return c.problem(path, 'spec "typed" needs a "type_id"');
		if (t.typeId !== typeId)
			return c.problem(
				path,
				`expected type ${JSON.stringify(typeId)}, got ${JSON.stringify(t.typeId)}`,
			);
		const vs = arg(args, "value");
		return vs === undefined ? true : c.match(vs, t.value, [...path, "value"]);
	},
	node: (c, args, x, path) => {
		if (!expectKind(c, x, "node", path, "a Node")) return false;
		const n = x as Node;
		const tag = stringArg(c, args, "tag", path);
		if (tag === false) return false;
		if (tag !== undefined && n.tag !== tag)
			return c.problem(
				path,
				`expected a ${JSON.stringify(tag)} node, got ${JSON.stringify(n.tag)}`,
			);
		const attrs = arg(args, "attrs");
		const children = arg(args, "children");
		let ok = true;
		if (attrs !== undefined) ok = c.match(attrs, n.attributes, [...path, "attrs"]) && ok;
		if (children !== undefined) ok = c.match(children, n.children, [...path, "children"]) && ok;
		return ok;
	},
	message: (c, args, x, path) => {
		if (!isMessage(x)) return c.problem(path, `expected a message, got ${describe(x)}`);
		const m = x;
		let ok = true;
		for (const k of ["id", "kind"] as const) {
			const s = arg(args, k);
			if (s !== undefined) ok = c.match(s, m[k], [...path, k]) && ok;
		}
		const data = arg(args, "data");
		if (data !== undefined) {
			if (hasMessages(m))
				ok = c.problem([...path, "data"], "expected data, the message has messages");
			else ok = c.match(data, m.data, [...path, "data"]) && ok;
		}
		const msgs = arg(args, "messages");
		if (msgs !== undefined) {
			if (!hasMessages(m))
				ok = c.problem([...path, "messages"], "expected messages, the message has data");
			else ok = matchMessages(c, msgs, m.messages, [...path, "messages"]) && ok;
		}
		const meta = arg(args, "meta");
		if (meta !== undefined) {
			if (!(meta instanceof Map))
				return c.problem(path, 'spec argument "meta" must be an Object of URI → spec');
			for (const [uri, s] of meta) {
				const headers = m.meta.get(uri);
				const at = [...path, "meta", uri];
				if (!headers) ok = c.problem(at, `missing dialect ${JSON.stringify(uri)}`);
				else ok = c.match(s, headers, at) && ok;
			}
		}
		return ok;
	},
	messages: (c, _args, _x, path) =>
		c.problem(path, 'spec "messages" only applies to a message\'s "messages"'),
	and: (c, args, x, path) => {
		const of = listArg(c, args, "of", path);
		if (of === false) return false;
		return all(of.map((s) => c.match(s, x, path)));
	},
	or: (c, args, x, path) => {
		const alts = arg(args, "alts");
		if (!(alts instanceof Map))
			return c.problem(path, 'spec argument "alts" must be an Object of name → spec');
		for (const [name, s] of alts) {
			const r = c.attempt((sc) => sc.match(s, x, path));
			if (r.ok) {
				c.picks.push({ path: [...path], alt: name }, ...r.picks);
				return true;
			}
		}
		return c.problem(path, "no alt matched");
	},
	maybe: (c, args, x, path) => {
		if (x === null) return true;
		const of = arg(args, "of");
		if (of === undefined) return c.problem(path, 'spec "maybe" needs "of"');
		return c.match(of, x, path);
	},
	not: (c, args, x, path) => {
		const of = arg(args, "of");
		if (of === undefined) return c.problem(path, 'spec "not" needs "of"');
		const r = c.attempt((sc) => sc.match(of, x, path));
		return r.ok ? c.problem(path, "matched a spec it must not match") : true;
	},
};

// A message's `messages`: a `messages` form, or a name that resolves to one, or a combinator.
const matchMessages = (c: Ctx, s: Value, items: Message[], path: Path): boolean => {
	let target = s;
	for (let i = 0; typeof target === "string" && i < MAX_DEPTH; i++) {
		const named = c.reg.get(target);
		if (named === undefined) return c.problem(path, `unknown spec ${JSON.stringify(target)}`);
		target = named;
	}
	if (
		target instanceof Typed &&
		target.typeId === `${SPEC_PREFIX}messages` &&
		target.value instanceof Map
	)
		return messagesOf(c, target.value, items, path);
	if (target instanceof Typed && target.typeId === `${SPEC_PREFIX}any`) return true;
	return c.problem(path, 'a message\'s "messages" takes a "messages" spec');
};
