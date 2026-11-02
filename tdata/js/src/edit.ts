// Persistent updates by path (docs/spec.md §4.5). The result shares every part off the path with
// the input, so those parts encode to the same bytes as before.
//
// Path segments: in a message, "id" "kind" "data" "messages" "meta"; under "meta", a dialect URI
// then a header name; in an Object, a key; in an Array, an Int (or a number) index; in a Node,
// "tag" "attrs" "children"; in a Typed, "value".

import {
	hasMessages,
	isMessage,
	type Message,
	Node,
	TdataError,
	Typed,
	type Value,
} from "./model.ts";
import type { Path } from "./spec.ts";

type Seg = string | bigint | number;
type Any = Value | Message | Map<string, unknown> | unknown;

const index = (s: Seg, n: number): number => {
	if (typeof s === "string") throw new TdataError(`an index is needed, got ${JSON.stringify(s)}`);
	const i = Number(s);
	if (!Number.isInteger(i) || i < 0 || i >= n) throw new TdataError(`index ${s} is out of range`);
	return i;
};

const key = (s: Seg): string => {
	if (typeof s !== "string") throw new TdataError(`a key is needed, got ${s}`);
	return s;
};

const child = (x: Any, s: Seg): unknown => {
	if (isMessage(x)) {
		switch (s) {
			case "id":
			case "kind":
			case "meta":
				return x[s];
			case "data":
				if (hasMessages(x)) throw new TdataError("the message has messages, not data");
				return x.data;
			case "messages":
				if (!hasMessages(x)) throw new TdataError("the message has data, not messages");
				return x.messages;
		}
		throw new TdataError(`a message has no ${JSON.stringify(s)}`);
	}
	if (Array.isArray(x)) return x[index(s, x.length)];
	if (x instanceof Map) return x.get(key(s));
	if (x instanceof Node) {
		if (s === "tag") return x.tag;
		if (s === "attrs") return x.attributes;
		if (s === "children") return x.children;
		throw new TdataError(`a Node has no ${JSON.stringify(s)}`);
	}
	if (x instanceof Typed && s === "value") return x.value;
	throw new TdataError(`can't step into ${typeof x} with ${String(s)}`);
};

const withChild = (x: Any, s: Seg, v: unknown): unknown => {
	if (isMessage(x)) {
		child(x, s);
		return { ...x, [s as string]: v };
	}
	if (Array.isArray(x)) {
		const out = x.slice();
		out[index(s, x.length)] = v as Value;
		return out;
	}
	if (x instanceof Map) {
		const out = new Map(x);
		out.set(key(s), v);
		return out;
	}
	if (x instanceof Node) {
		if (s === "tag") return new Node(v as string, x.attributes, x.children);
		if (s === "attrs") return new Node(x.tag, v as Map<string, Value>, x.children);
		if (s === "children") return new Node(x.tag, x.attributes, v as Value[]);
	}
	if (x instanceof Typed && s === "value") return new Typed(x.typeId, v);
	throw new TdataError(`can't set ${String(s)} in ${typeof x}`);
};

export const getIn = (x: Any, path: readonly Seg[] | Path): unknown => {
	let cur: unknown = x;
	for (const s of path) {
		if (cur === undefined) return undefined;
		cur = child(cur, s);
	}
	return cur;
};

export const updateIn = <T extends Any>(
	x: T,
	path: readonly Seg[] | Path,
	f: (v: unknown) => unknown,
): T => {
	if (path.length === 0) return f(x) as T;
	const [s, ...rest] = path;
	const old = child(x, s);
	const v = updateIn(old as Any, rest, f);
	return (v === old ? x : withChild(x, s, v)) as T;
};

export const setIn = <T extends Any>(x: T, path: readonly Seg[] | Path, v: unknown): T =>
	updateIn(x, path, () => v);
