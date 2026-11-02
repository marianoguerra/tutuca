// The JSON encoding (docs/spec.md §2): plain JSON text, with Cap'n Web-style tagged arrays.
// A JSON array is either an escaped Array literal, [[e…]], or a tagged form, ["tag", args…].
//
// Decoding reads the text with its own tokenizer instead of JSON.parse: JSON.parse forgets
// whether a number was written `1` or `1.0`, rounds integers past 2⁵³, and keeps the last of
// two duplicate keys. The tokenizer reads straight into values, so it never builds an
// intermediate tree.

import { type Codecs, noCodecs } from "./codecs.ts";
import { equal } from "./equal.ts";
import {
	hasMessages,
	INT_MAX,
	INT_MIN,
	Instant,
	isInt,
	kindOf,
	type Message,
	type Meta,
	Node,
	Ref,
	type Scalar,
	TdataError,
	Typed,
	type Value,
} from "./model.ts";

export interface JsonOptions {
	codecs?: Codecs;
}

// ---- Encoding --------------------------------------------------------------------------------

export const encodeValue = (v: unknown, opts: JsonOptions = {}): string => {
	const out: string[] = [];
	writeValue(out, v, opts.codecs ?? noCodecs);
	return out.join("");
};

export const encodeMessage = (m: Message, opts: JsonOptions = {}): string => {
	const out: string[] = [];
	writeMessage(out, m, opts.codecs ?? noCodecs);
	return out.join("");
};

const str = (s: string): string => {
	if (!s.isWellFormed()) throw new TdataError("a string has a lone surrogate");
	return JSON.stringify(s);
};

/** The JSON text of a finite Double other than -0: shortest round-trip, with `.0` if integral. */
export const doubleText = (n: number): string => {
	const s = String(n);
	return /[.eE]/.test(s) ? s : `${s}.0`;
};

const writeValue = (out: string[], v: unknown, codecs: Codecs): void => {
	switch (kindOf(v)) {
		case "null":
			out.push("null");
			return;
		case "bool":
			out.push(v ? "true" : "false");
			return;
		case "int":
			if (!isInt(v)) throw new TdataError(`an Int is outside the i64 range: ${v}`);
			out.push(String(v));
			return;
		case "double": {
			const n = v as number;
			if (Number.isNaN(n)) out.push('["num","NaN"]');
			else if (n === Infinity) out.push('["num","Infinity"]');
			else if (n === -Infinity) out.push('["num","-Infinity"]');
			else if (Object.is(n, -0)) out.push('["num","-0"]');
			else out.push(doubleText(n));
			return;
		}
		case "string":
			out.push(str(v as string));
			return;
		case "bytes":
			out.push('["bytes",', JSON.stringify((v as Uint8Array).toBase64()), "]");
			return;
		case "instant": {
			const ns = (v as Instant).epochNanoseconds;
			if (!isInt(ns)) throw new TdataError(`an Instant is outside the i64 range: ${ns}`);
			out.push('["inst","', String(ns), '"]');
			return;
		}
		case "ref":
			out.push('["ref",', str((v as Ref).uri), "]");
			return;
		case "array":
			out.push("[");
			writeList(out, v as unknown[], codecs);
			out.push("]");
			return;
		case "object":
			writeObject(out, v as Map<string, unknown>, codecs);
			return;
		case "set":
			out.push('["set",[');
			writeList(out, [...(v as Set<unknown>)], codecs);
			out.push("]]");
			return;
		case "typed": {
			const t = v as Typed<unknown>;
			if (t.typeId === "") throw new TdataError("a Typed has an empty type_id");
			out.push('["#",', str(t.typeId), ",");
			writeValue(out, t.value, codecs);
			out.push("]");
			return;
		}
		case "node": {
			const n = v as Node;
			out.push('["node",', str(n.tag), ",");
			writeObject(out, n.attributes, codecs);
			out.push(",[");
			writeList(out, n.children, codecs);
			out.push("]]");
			return;
		}
		default: {
			const wire = codecs.wireView(v);
			if (!wire) throw new TdataError(`not a tdata value and no codec encodes it: ${describe(v)}`);
			writeValue(out, wire, codecs);
		}
	}
};

const describe = (v: unknown): string =>
	typeof v === "object" && v !== null ? (v.constructor?.name ?? "object") : typeof v;

// An encoded Array: `[e…]`, written inside the escaping brackets the caller writes.
const writeList = (out: string[], items: readonly unknown[], codecs: Codecs): void => {
	out.push("[");
	for (let i = 0; i < items.length; i++) {
		if (i > 0) out.push(",");
		writeValue(out, items[i], codecs);
	}
	out.push("]");
};

const writeObject = (out: string[], m: Map<string, unknown>, codecs: Codecs): void => {
	out.push("{");
	let first = true;
	for (const [k, v] of m) {
		if (typeof k !== "string") throw new TdataError("an Object key is not a string");
		if (!first) out.push(",");
		first = false;
		out.push(str(k), ":");
		writeValue(out, v, codecs);
	}
	out.push("}");
};

const writeMessage = (out: string[], m: Message, codecs: Codecs): void => {
	out.push('{"id":', str(m.id), ',"kind":', str(m.kind));
	if (hasMessages(m)) {
		out.push(',"messages":[');
		m.messages.forEach((child, i) => {
			if (i > 0) out.push(",");
			writeMessage(out, child, codecs);
		});
		out.push("]");
	} else {
		out.push(',"data":');
		writeValue(out, m.data, codecs);
	}
	if (m.meta.size > 0) {
		out.push(',"meta":{');
		let first = true;
		for (const [uri, headers] of m.meta) {
			if (!first) out.push(",");
			first = false;
			out.push(str(uri), ":");
			for (const h of headers.values()) checkScalar(h, "a header");
			writeObject(out, headers, codecs);
		}
		out.push("}");
	}
	out.push("}");
};

const SCALAR_KINDS = new Set([
	"null",
	"bool",
	"int",
	"double",
	"string",
	"bytes",
	"instant",
	"ref",
]);

export const isScalar = (v: unknown): v is Scalar => SCALAR_KINDS.has(kindOf(v) ?? "");

const checkScalar = (v: unknown, what: string): void => {
	if (!isScalar(v)) throw new TdataError(`${what} value is not a Scalar`);
};

// ---- Decoding --------------------------------------------------------------------------------

export const decodeValue = (text: string, opts: JsonOptions = {}): Value => {
	const r = new Reader(text, opts.codecs ?? noCodecs);
	const v = r.value();
	r.end();
	return v;
};

export const decodeMessage = (text: string, opts: JsonOptions = {}): Message => {
	const r = new Reader(text, opts.codecs ?? noCodecs);
	const m = r.message();
	r.end();
	return m;
};

const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const DECIMAL_INT = /^-?(?:0|[1-9][0-9]*)$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TAG_ARITY: Record<string, number> = {
	num: 1,
	bytes: 1,
	inst: 1,
	ref: 1,
	set: 1,
	"#": 2,
	node: 3,
};

class Reader {
	text: string;
	pos = 0;
	codecs: Codecs;

	constructor(text: string, codecs: Codecs) {
		this.text = text;
		this.codecs = codecs;
	}

	fail(what: string): never {
		const { line, col } = this.where();
		throw new TdataError(`${what} at line ${line}, col ${col}`);
	}

	where(): { line: number; col: number } {
		let line = 1;
		let start = 0;
		for (let i = 0; i < this.pos && i < this.text.length; i++) {
			if (this.text.charCodeAt(i) === 10) {
				line++;
				start = i + 1;
			}
		}
		return { line, col: this.pos - start + 1 };
	}

	ws(): void {
		const t = this.text;
		while (this.pos < t.length) {
			const c = t.charCodeAt(this.pos);
			if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
			this.pos++;
		}
	}

	peek(): string {
		this.ws();
		return this.text[this.pos] ?? "";
	}

	expect(ch: string): void {
		if (this.peek() !== ch) this.fail(`expected "${ch}"`);
		this.pos++;
	}

	/** Consumes `ch` if it's next. */
	eat(ch: string): boolean {
		if (this.peek() !== ch) return false;
		this.pos++;
		return true;
	}

	end(): void {
		this.ws();
		if (this.pos !== this.text.length) this.fail("unexpected text after the value");
	}

	word(w: string): void {
		if (!this.text.startsWith(w, this.pos)) this.fail("unexpected character");
		this.pos += w.length;
	}

	value(): Value {
		const c = this.peek();
		switch (c) {
			case "{":
				return this.object();
			case "[":
				return this.arrayForm();
			case '"':
				return this.string();
			case "t":
				this.word("true");
				return true;
			case "f":
				this.word("false");
				return false;
			case "n":
				this.word("null");
				return null;
			case "":
				return this.fail("unexpected end of input");
			default:
				if (c === "-" || (c >= "0" && c <= "9")) return this.number();
				return this.fail("unexpected character");
		}
	}

	number(): bigint | number {
		NUMBER.lastIndex = this.pos;
		const m = NUMBER.exec(this.text);
		if (!m) return this.fail("malformed number");
		this.pos += m[0].length;
		if (m[1] === undefined && m[2] === undefined) {
			const n = BigInt(m[0]);
			if (n < INT_MIN || n > INT_MAX) this.fail("an integer outside the Int range (i64)");
			return n;
		}
		return Number(m[0]);
	}

	string(): string {
		const t = this.text;
		if (t[this.pos] !== '"') this.fail("expected a string");
		this.pos++;
		let out = "";
		let start = this.pos;
		for (;;) {
			if (this.pos >= t.length) this.fail("unterminated string");
			const c = t.charCodeAt(this.pos);
			if (c === 34) break;
			if (c < 32) this.fail("a control character in a string");
			if (c !== 92) {
				this.pos++;
				continue;
			}
			out += t.slice(start, this.pos);
			const e = t[this.pos + 1];
			this.pos += 2;
			switch (e) {
				case '"':
				case "\\":
				case "/":
					out += e;
					break;
				case "b":
					out += "\b";
					break;
				case "f":
					out += "\f";
					break;
				case "n":
					out += "\n";
					break;
				case "r":
					out += "\r";
					break;
				case "t":
					out += "\t";
					break;
				case "u": {
					const hex = t.slice(this.pos, this.pos + 4);
					if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("a malformed \\u escape");
					out += String.fromCharCode(Number.parseInt(hex, 16));
					this.pos += 4;
					break;
				}
				default:
					this.pos -= 2;
					this.fail("an unknown escape");
			}
			start = this.pos;
		}
		out += t.slice(start, this.pos);
		this.pos++;
		if (!out.isWellFormed()) this.fail("a lone surrogate in a string");
		return out;
	}

	/** `[e…]` after the caller found `[`: the elements of an encoded Array. */
	elements(): Value[] {
		this.expect("[");
		const items: Value[] = [];
		if (this.eat("]")) return items;
		do items.push(this.value());
		while (this.eat(","));
		this.expect("]");
		return items;
	}

	object(): Map<string, Value> {
		this.expect("{");
		const m = new Map<string, Value>();
		if (this.eat("}")) return m;
		do {
			if (this.peek() !== '"') this.fail("expected a key");
			const k = this.string();
			if (m.has(k)) this.fail(`a duplicate key ${JSON.stringify(k)}`);
			this.expect(":");
			m.set(k, this.value());
		} while (this.eat(","));
		this.expect("}");
		return m;
	}

	arrayForm(): Value {
		const at = this.pos;
		this.expect("[");
		const c = this.peek();
		if (c === "[") {
			const items = this.elements();
			this.expect("]");
			return items;
		}
		if (c !== '"') {
			this.pos = at;
			this.fail('an array must be an escaped Array [[…]] or a tagged form ["tag", …]');
		}
		const tag = this.string();
		const arity = TAG_ARITY[tag];
		if (arity === undefined) {
			this.pos = at;
			this.fail(`an unknown tag ${JSON.stringify(tag)}`);
		}
		const v = this.tagged(tag);
		if (this.peek() === ",") this.fail(`too many arguments for "${tag}"`);
		this.expect("]");
		return v;
	}

	stringArg(tag: string): string {
		if (!this.eat(",")) this.fail(`"${tag}" takes ${TAG_ARITY[tag]} argument(s)`);
		if (this.peek() !== '"') this.fail(`"${tag}" expects a string argument`);
		return this.string();
	}

	encodedArrayArg(tag: string): Value[] {
		if (!this.eat(",")) this.fail(`"${tag}" takes ${TAG_ARITY[tag]} argument(s)`);
		if (this.peek() !== "[") this.fail(`"${tag}" expects an Array [[…]]`);
		this.expect("[");
		if (this.peek() !== "[") this.fail(`"${tag}" expects an Array [[…]]`);
		const items = this.elements();
		this.expect("]");
		return items;
	}

	tagged(tag: string): Value {
		switch (tag) {
			case "num": {
				const s = this.stringArg(tag);
				switch (s) {
					case "NaN":
						return Number.NaN;
					case "Infinity":
						return Infinity;
					case "-Infinity":
						return -Infinity;
					case "-0":
						return -0;
				}
				return this.fail(`"num" takes NaN, Infinity, -Infinity or -0, not ${JSON.stringify(s)}`);
			}
			case "bytes": {
				const s = this.stringArg(tag);
				if (!BASE64.test(s)) this.fail("malformed base64");
				try {
					return Uint8Array.fromBase64(s, { lastChunkHandling: "strict" });
				} catch {
					return this.fail("malformed base64");
				}
			}
			case "inst": {
				const s = this.stringArg(tag);
				if (!DECIMAL_INT.test(s)) this.fail("an Instant must be a decimal integer string");
				const ns = BigInt(s);
				if (!isInt(ns)) this.fail("an Instant outside the i64 range");
				return new Instant(ns);
			}
			case "ref":
				return new Ref(this.stringArg(tag));
			case "set": {
				const items = this.encodedArrayArg(tag);
				for (let i = 1; i < items.length; i++)
					for (let j = 0; j < i; j++)
						if (equal(items[i], items[j], this.codecs)) this.fail("a Set with two equal elements");
				return new Set(items);
			}
			case "#": {
				const typeId = this.stringArg(tag);
				if (typeId === "") this.fail("an empty type_id");
				if (!this.eat(",")) this.fail('"#" takes 2 arguments');
				const v = this.value();
				return this.codecs.decodeTyped(new Typed(typeId, v)) as Value;
			}
			case "node": {
				const name = this.stringArg(tag);
				if (!this.eat(",")) this.fail('"node" takes 3 arguments');
				if (this.peek() !== "{") this.fail('"node" expects an attributes object');
				const attrs = this.object();
				const children = this.encodedArrayArg(tag);
				return new Node(name, attrs, children);
			}
		}
		return this.fail(`an unknown tag ${JSON.stringify(tag)}`);
	}

	message(): Message {
		this.expect("{");
		const seen = new Set<string>();
		let id: string | undefined;
		let kind: string | undefined;
		let data: Value | undefined;
		let hasData = false;
		let children: Message[] | undefined;
		let meta: Meta = new Map();
		if (!this.eat("}")) {
			do {
				if (this.peek() !== '"') this.fail("expected a key");
				const k = this.string();
				if (seen.has(k)) this.fail(`a duplicate key ${JSON.stringify(k)}`);
				seen.add(k);
				this.expect(":");
				switch (k) {
					case "id":
						if (this.peek() !== '"') this.fail("a message id must be a string");
						id = this.string();
						break;
					case "kind":
						if (this.peek() !== '"') this.fail("a message kind must be a string");
						kind = this.string();
						break;
					case "data":
						data = this.value();
						hasData = true;
						break;
					case "messages":
						children = [];
						this.expect("[");
						if (!this.eat("]")) {
							do children.push(this.message());
							while (this.eat(","));
							this.expect("]");
						}
						break;
					case "meta":
						meta = this.meta();
						break;
					default:
						this.fail(`an unknown message key ${JSON.stringify(k)}`);
				}
			} while (this.eat(","));
			this.expect("}");
		}
		if (id === undefined) this.fail('a message without "id"');
		if (kind === undefined) this.fail('a message without "kind"');
		if (hasData === (children !== undefined))
			this.fail('a message needs exactly one of "data" and "messages"');
		return children
			? { id, kind, messages: children, meta }
			: { id, kind, data: data as Value, meta };
	}

	meta(): Meta {
		this.expect("{");
		const m: Meta = new Map();
		if (this.eat("}")) return m;
		do {
			if (this.peek() !== '"') this.fail("expected a dialect URI");
			const uri = this.string();
			if (m.has(uri)) this.fail(`a duplicate dialect ${JSON.stringify(uri)}`);
			this.expect(":");
			if (this.peek() !== "{") this.fail("a dialect's headers must be an object");
			const headers = this.object();
			for (const [k, v] of headers)
				if (!isScalar(v)) this.fail(`header ${JSON.stringify(k)} is not a Scalar`);
			m.set(uri, headers as Map<string, Scalar>);
		} while (this.eat(","));
		this.expect("}");
		return m;
	}
}
