// The tdata data model (docs/spec.md §1): scalars, values and messages.
//
// JS representation:
//   Null → null, Bool → boolean, Int → bigint (always within i64), Double → number,
//   String → string, Bytes → Uint8Array, Instant → Instant, Ref → Ref,
//   Array → Value[], Object → Map<string, Value>, Set → Set<Value>,
//   Typed → Typed, Node → Node.
// Objects are Maps: plain objects reorder integer-like keys, which would break byte-exact
// round trips. A Message is a plain object { id, kind, data | messages, meta }.

/** A reference to something outside the message, as a URI. */
export class Ref {
	readonly uri: string;
	constructor(uri: string) {
		this.uri = uri;
	}
}

/** Nanoseconds since the Unix epoch, within i64. */
export class Instant {
	readonly epochNanoseconds: bigint;
	constructor(epochNanoseconds: bigint) {
		this.epochNanoseconds = epochNanoseconds;
	}
	static fromMillis(ms: number): Instant {
		return new Instant(BigInt(Math.trunc(ms)) * 1_000_000n);
	}
	toMillis(): number {
		return Number(this.epochNanoseconds / 1_000_000n);
	}
}

/** A tag and a payload: an application value, or the envelope of an unregistered tag. */
export class Typed<T = Value> {
	readonly typeId: string;
	readonly value: T;
	constructor(typeId: string, value: T) {
		this.typeId = typeId;
		this.value = value;
	}
}

/** A tagged tree node with named attributes and ordered children. */
export class Node {
	tag: string;
	attributes: Map<string, Value>;
	children: Value[];
	constructor(tag: string, attributes: Map<string, Value> = new Map(), children: Value[] = []) {
		this.tag = tag;
		this.attributes = attributes;
		this.children = children;
	}
}

/** Int is a bigint within i64; Double is a number. */
export type Scalar = null | boolean | bigint | number | string | Uint8Array | Instant | Ref;

/**
 * Scalars, collections, typed values and nodes. `unknown` is not a Value, but a native (a value
 * some registered codec accepts) can stand wherever a Value can when encoding.
 */
export type Value = Scalar | Value[] | Map<string, Value> | Set<Value> | Typed | Node;

export type Headers = Map<string, Scalar>;
export type Meta = Map<string, Headers>;

interface MessageBase {
	id: string;
	kind: string;
	meta: Meta;
}
export type DataMessage = MessageBase & { data: Value; messages?: never };
export type ListMessage = MessageBase & { messages: Message[]; data?: never };
export type Message = DataMessage | ListMessage;

export const INT_MIN = -(2n ** 63n);
export const INT_MAX = 2n ** 63n - 1n;

export const isInt = (x: unknown): x is bigint =>
	typeof x === "bigint" && x >= INT_MIN && x <= INT_MAX;

/** An Int from a number or a bigint; throws if it isn't an integer within i64. */
export const int = (n: number | bigint): bigint => {
	if (typeof n === "number" && !Number.isInteger(n)) throw new RangeError(`not an integer: ${n}`);
	const b = BigInt(n);
	if (!isInt(b)) throw new RangeError(`outside the Int range: ${b}`);
	return b;
};

/** An Object from a plain object's entries, in their order. */
export const obj = (
	entries: Record<string, Value> | Iterable<[string, Value]>,
): Map<string, Value> => new Map(Symbol.iterator in entries ? entries : Object.entries(entries));

export const node = (tag: string, attributes: Record<string, Value> = {}, children: Value[] = []) =>
	new Node(tag, obj(attributes), children);

export const meta = (dialects: Record<string, Record<string, Scalar>> = {}): Meta =>
	new Map(
		Object.entries(dialects).map(([uri, headers]) => [uri, new Map(Object.entries(headers))]),
	);

export const message = (
	id: string,
	kind: string,
	data: Value,
	m: Meta = new Map(),
): DataMessage => ({
	id,
	kind,
	data,
	meta: m,
});

export const messages = (
	id: string,
	kind: string,
	children: Message[],
	m: Meta = new Map(),
): ListMessage => ({
	id,
	kind,
	messages: children,
	meta: m,
});

export const isMessage = (x: unknown): x is Message =>
	typeof x === "object" &&
	x !== null &&
	Object.getPrototypeOf(x) === Object.prototype &&
	typeof (x as Message).id === "string" &&
	typeof (x as Message).kind === "string";

export const hasMessages = (m: Message): m is ListMessage => m.messages !== undefined;

/** The case of a value, as a word (also what problems and errors call it). */
export type Kind =
	| "null"
	| "bool"
	| "int"
	| "double"
	| "string"
	| "bytes"
	| "instant"
	| "ref"
	| "array"
	| "object"
	| "set"
	| "typed"
	| "node";

/** The case of `x`, or undefined when it isn't a tdata value (a native, or anything else). */
export const kindOf = (x: unknown): Kind | undefined => {
	if (x === null) return "null";
	switch (typeof x) {
		case "boolean":
			return "bool";
		case "bigint":
			return "int";
		case "number":
			return "double";
		case "string":
			return "string";
		case "object":
			break;
		default:
			return undefined;
	}
	if (x instanceof Uint8Array) return "bytes";
	if (Array.isArray(x)) return "array";
	if (x instanceof Map) return "object";
	if (x instanceof Set) return "set";
	if (x instanceof Typed) return "typed";
	if (x instanceof Node) return "node";
	if (x instanceof Instant) return "instant";
	if (x instanceof Ref) return "ref";
	return undefined;
};

/** Thrown by the decoders on malformed input, and by the encoders on values they can't encode. */
export class TdataError extends Error {
	override name = "TdataError";
}
