// The CBOR encoding (docs/spec.md §3): a subset of RFC 8949 with definite lengths and shortest
// heads. Integers are Ints and floats are Doubles, always.

import { type Codecs, noCodecs } from "./codecs.ts";
import { equal } from "./equal.ts";
import { isScalar } from "./json.ts";
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

export const TAG_TYPED = 27;
export const TAG_URI = 32;
export const TAG_SET = 258;
export const TAG_NODE = 37700;
export const TAG_INSTANT = 37701;
export const TAG_SELF_DESCRIBE = 55799;

export interface CborOptions {
	codecs?: Codecs;
	/** Prefix the item with the self-describe tag 55799. */
	selfDescribe?: boolean;
}

// ---- Encoding --------------------------------------------------------------------------------

class Writer {
	buf = new Uint8Array(256);
	view = new DataView(this.buf.buffer);
	len = 0;

	room(n: number): void {
		if (this.len + n <= this.buf.length) return;
		let size = this.buf.length * 2;
		while (size < this.len + n) size *= 2;
		const bigger = new Uint8Array(size);
		bigger.set(this.buf.subarray(0, this.len));
		this.buf = bigger;
		this.view = new DataView(bigger.buffer);
	}

	byte(b: number): void {
		this.room(1);
		this.buf[this.len++] = b;
	}

	bytes(b: Uint8Array): void {
		this.room(b.length);
		this.buf.set(b, this.len);
		this.len += b.length;
	}

	/** A head: major type and argument, in the shortest form. */
	head(major: number, arg: number | bigint): void {
		const mt = major << 5;
		const n = BigInt(arg);
		if (n < 24n) this.byte(mt | Number(n));
		else if (n < 0x100n) {
			this.byte(mt | 24);
			this.byte(Number(n));
		} else if (n < 0x10000n) {
			this.room(3);
			this.buf[this.len] = mt | 25;
			this.view.setUint16(this.len + 1, Number(n));
			this.len += 3;
		} else if (n < 0x100000000n) {
			this.room(5);
			this.buf[this.len] = mt | 26;
			this.view.setUint32(this.len + 1, Number(n));
			this.len += 5;
		} else {
			this.room(9);
			this.buf[this.len] = mt | 27;
			this.view.setBigUint64(this.len + 1, n);
			this.len += 9;
		}
	}

	text(s: string): void {
		if (!s.isWellFormed()) throw new TdataError("a string has a lone surrogate");
		const b = utf8.encode(s);
		this.head(3, b.length);
		this.bytes(b);
	}

	int(n: bigint): void {
		if (n >= 0n) this.head(0, n);
		else this.head(1, -1n - n);
	}

	double(n: number): void {
		if (Number.isNaN(n)) {
			this.byte(0xf9);
			this.byte(0x7e);
			this.byte(0x00);
			return;
		}
		const half = toHalf(n);
		if (half !== undefined) {
			this.room(3);
			this.buf[this.len] = 0xf9;
			this.view.setUint16(this.len + 1, half);
			this.len += 3;
			return;
		}
		if (Math.fround(n) === n) {
			this.room(5);
			this.buf[this.len] = 0xfa;
			this.view.setFloat32(this.len + 1, n);
			this.len += 5;
			return;
		}
		this.room(9);
		this.buf[this.len] = 0xfb;
		this.view.setFloat64(this.len + 1, n);
		this.len += 9;
	}

	result(): Uint8Array {
		return this.buf.slice(0, this.len);
	}
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The binary16 bits of `n` if it converts exactly (NaN excluded), else undefined. */
export const toHalf = (n: number): number | undefined => {
	if (Number.isNaN(n)) return undefined;
	const f32 = Math.fround(n);
	if (f32 !== n) return undefined;
	const v = new DataView(new ArrayBuffer(4));
	v.setFloat32(0, f32);
	const bits = v.getUint32(0);
	const sign = (bits >>> 16) & 0x8000;
	const exp = (bits >>> 23) & 0xff;
	const mant = bits & 0x7fffff;
	if (exp === 0xff) return mant === 0 ? sign | 0x7c00 : undefined; // ±Inf
	if (exp === 0 && mant === 0) return sign; // ±0
	const e = exp - 127;
	if (e > 15) return undefined;
	if (e >= -14) {
		// normal: the low 13 mantissa bits must be zero
		if ((mant & 0x1fff) !== 0) return undefined;
		return sign | ((e + 15) << 10) | (mant >>> 13);
	}
	if (e < -24) return undefined;
	// subnormal: value = m × 2^-24, with m an integer < 1024
	const full = mant | 0x800000; // 1.mant as an integer × 2^-23
	const shift = -e - 14 + 13; // to get m: full >> (shift), must be exact
	if ((full & ((1 << shift) - 1)) !== 0) return undefined;
	return sign | (full >>> shift);
};

/** The double for binary16 bits. */
export const fromHalf = (h: number): number => {
	const sign = h & 0x8000 ? -1 : 1;
	const exp = (h >>> 10) & 0x1f;
	const mant = h & 0x3ff;
	if (exp === 0) return sign * mant * 2 ** -24;
	if (exp === 0x1f) return mant === 0 ? sign * Infinity : Number.NaN;
	return sign * (1 + mant / 1024) * 2 ** (exp - 15);
};

export const encodeValueCbor = (v: unknown, opts: CborOptions = {}): Uint8Array => {
	const w = new Writer();
	if (opts.selfDescribe) w.head(6, TAG_SELF_DESCRIBE);
	writeValue(w, v, opts.codecs ?? noCodecs);
	return w.result();
};

export const encodeMessageCbor = (m: Message, opts: CborOptions = {}): Uint8Array => {
	const w = new Writer();
	if (opts.selfDescribe) w.head(6, TAG_SELF_DESCRIBE);
	writeMessage(w, m, opts.codecs ?? noCodecs);
	return w.result();
};

const writeValue = (w: Writer, v: unknown, codecs: Codecs): void => {
	switch (kindOf(v)) {
		case "null":
			w.byte(0xf6);
			return;
		case "bool":
			w.byte(v ? 0xf5 : 0xf4);
			return;
		case "int":
			if (!isInt(v)) throw new TdataError(`an Int is outside the i64 range: ${v}`);
			w.int(v);
			return;
		case "double":
			w.double(v as number);
			return;
		case "string":
			w.text(v as string);
			return;
		case "bytes":
			w.head(2, (v as Uint8Array).length);
			w.bytes(v as Uint8Array);
			return;
		case "instant": {
			const ns = (v as Instant).epochNanoseconds;
			if (!isInt(ns)) throw new TdataError(`an Instant is outside the i64 range: ${ns}`);
			w.head(6, TAG_INSTANT);
			w.int(ns);
			return;
		}
		case "ref":
			w.head(6, TAG_URI);
			w.text((v as Ref).uri);
			return;
		case "array":
			writeList(w, v as unknown[], codecs);
			return;
		case "object":
			writeMap(w, v as Map<string, unknown>, codecs);
			return;
		case "set":
			w.head(6, TAG_SET);
			writeList(w, [...(v as Set<unknown>)], codecs);
			return;
		case "typed": {
			const t = v as Typed<unknown>;
			if (t.typeId === "") throw new TdataError("a Typed has an empty type_id");
			w.head(6, TAG_TYPED);
			w.head(4, 2);
			w.text(t.typeId);
			writeValue(w, t.value, codecs);
			return;
		}
		case "node": {
			const n = v as Node;
			w.head(6, TAG_NODE);
			w.head(4, 3);
			w.text(n.tag);
			writeMap(w, n.attributes, codecs);
			writeList(w, n.children, codecs);
			return;
		}
		default: {
			const wire = codecs.wireView(v);
			if (!wire) throw new TdataError("not a tdata value and no codec encodes it");
			writeValue(w, wire, codecs);
		}
	}
};

const writeList = (w: Writer, items: readonly unknown[], codecs: Codecs): void => {
	w.head(4, items.length);
	for (const x of items) writeValue(w, x, codecs);
};

const writeMap = (w: Writer, m: Map<string, unknown>, codecs: Codecs): void => {
	w.head(5, m.size);
	for (const [k, v] of m) {
		if (typeof k !== "string") throw new TdataError("an Object key is not a string");
		w.text(k);
		writeValue(w, v, codecs);
	}
};

const writeMessage = (w: Writer, m: Message, codecs: Codecs): void => {
	w.head(5, m.meta.size > 0 ? 4 : 3);
	w.text("id");
	w.text(m.id);
	w.text("kind");
	w.text(m.kind);
	if (hasMessages(m)) {
		w.text("messages");
		w.head(4, m.messages.length);
		for (const child of m.messages) writeMessage(w, child, codecs);
	} else {
		w.text("data");
		writeValue(w, m.data, codecs);
	}
	if (m.meta.size > 0) {
		w.text("meta");
		w.head(5, m.meta.size);
		for (const [uri, headers] of m.meta) {
			w.text(uri);
			for (const h of headers.values())
				if (!isScalar(h)) throw new TdataError("a header value is not a Scalar");
			writeMap(w, headers, codecs);
		}
	}
};

// ---- Decoding --------------------------------------------------------------------------------

export const decodeValueCbor = (bytes: Uint8Array, opts: CborOptions = {}): Value => {
	const r = new Reader(bytes, opts.codecs ?? noCodecs);
	r.selfDescribe();
	const v = r.value();
	r.end();
	return v;
};

export const decodeMessageCbor = (bytes: Uint8Array, opts: CborOptions = {}): Message => {
	const r = new Reader(bytes, opts.codecs ?? noCodecs);
	r.selfDescribe();
	const m = r.message();
	r.end();
	return m;
};

interface Head {
	major: number;
	info: number;
	arg: bigint;
}

class Reader {
	bytes: Uint8Array;
	view: DataView;
	pos = 0;
	codecs: Codecs;

	constructor(bytes: Uint8Array, codecs: Codecs) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.codecs = codecs;
	}

	fail(what: string): never {
		throw new TdataError(`${what} at byte ${this.pos}`);
	}

	need(n: number): void {
		if (this.pos + n > this.bytes.length) this.fail("unexpected end of input");
	}

	end(): void {
		if (this.pos !== this.bytes.length) this.fail("bytes left after the item");
	}

	selfDescribe(): void {
		const b = this.bytes;
		if (b.length >= 3 && b[0] === 0xd9 && b[1] === 0xd9 && b[2] === 0xf7) this.pos = 3;
	}

	head(): Head {
		this.need(1);
		const ib = this.bytes[this.pos++];
		const major = ib >> 5;
		const info = ib & 0x1f;
		let arg: bigint;
		if (info < 24) arg = BigInt(info);
		else if (info === 24) {
			this.need(1);
			arg = BigInt(this.bytes[this.pos]);
			this.pos += 1;
		} else if (info === 25) {
			this.need(2);
			arg = BigInt(this.view.getUint16(this.pos));
			this.pos += 2;
		} else if (info === 26) {
			this.need(4);
			arg = BigInt(this.view.getUint32(this.pos));
			this.pos += 4;
		} else if (info === 27) {
			this.need(8);
			arg = this.view.getBigUint64(this.pos);
			this.pos += 8;
		} else if (info === 31) {
			this.pos--;
			return this.fail("an indefinite length");
		} else {
			this.pos--;
			return this.fail("a reserved additional-information value");
		}
		return { major, info, arg };
	}

	length(h: Head): number {
		// Every byte, element or entry takes at least one byte, so a count past the end is wrong.
		if (h.arg > BigInt(this.bytes.length - this.pos))
			this.fail("a length past the end of the input");
		return Number(h.arg);
	}

	textAfter(h: Head): string {
		const n = this.length(h);
		this.need(n);
		let s: string;
		try {
			s = utf8Decoder.decode(this.bytes.subarray(this.pos, this.pos + n));
		} catch {
			return this.fail("invalid UTF-8");
		}
		this.pos += n;
		return s;
	}

	text(what: string): string {
		const h = this.head();
		if (h.major !== 3) this.fail(`${what} must be a text string`);
		return this.textAfter(h);
	}

	intAfter(h: Head): bigint {
		const n = h.major === 0 ? h.arg : -1n - h.arg;
		if (n < INT_MIN || n > INT_MAX) this.fail("an integer outside the Int range (i64)");
		return n;
	}

	value(): Value {
		const start = this.pos;
		const h = this.head();
		switch (h.major) {
			case 0:
			case 1:
				return this.intAfter(h);
			case 2: {
				const n = this.length(h);
				this.need(n);
				const b = this.bytes.slice(this.pos, this.pos + n);
				this.pos += n;
				return b;
			}
			case 3:
				return this.textAfter(h);
			case 4: {
				const n = this.length(h);
				const items: Value[] = [];
				for (let i = 0; i < n; i++) items.push(this.value());
				return items;
			}
			case 5:
				return this.mapAfter(h);
			case 6:
				return this.taggedAfter(h, start);
			default:
				return this.simpleAfter(h, start);
		}
	}

	mapAfter(h: Head): Map<string, Value> {
		const n = this.length(h);
		const m = new Map<string, Value>();
		for (let i = 0; i < n; i++) {
			const k = this.text("a map key");
			if (m.has(k)) this.fail(`a duplicate key ${JSON.stringify(k)}`);
			m.set(k, this.value());
		}
		return m;
	}

	map(what: string): Map<string, Value> {
		const h = this.head();
		if (h.major !== 5) this.fail(`${what} must be a map`);
		return this.mapAfter(h);
	}

	array(what: string): Value[] {
		const v = this.value();
		if (!Array.isArray(v)) this.fail(`${what} must be an array`);
		return v;
	}

	arrayHead(n: number, what: string): void {
		const h = this.head();
		if (h.major !== 4 || h.arg !== BigInt(n)) this.fail(`${what} must be an array of ${n}`);
	}

	taggedAfter(h: Head, start: number): Value {
		switch (h.arg) {
			case BigInt(TAG_URI):
				return new Ref(this.text("a URI"));
			case BigInt(TAG_SET): {
				const items = this.array("a set");
				for (let i = 1; i < items.length; i++)
					for (let j = 0; j < i; j++)
						if (equal(items[i], items[j], this.codecs)) this.fail("a Set with two equal elements");
				return new Set(items);
			}
			case BigInt(TAG_TYPED): {
				this.arrayHead(2, "a Typed");
				const typeId = this.text("a type_id");
				if (typeId === "") this.fail("an empty type_id");
				const v = this.value();
				return this.codecs.decodeTyped(new Typed(typeId, v)) as Value;
			}
			case BigInt(TAG_NODE): {
				this.arrayHead(3, "a Node");
				const tag = this.text("a node tag");
				const attrs = this.map("a node's attributes");
				const children = this.array("a node's children");
				return new Node(tag, attrs, children);
			}
			case BigInt(TAG_INSTANT): {
				const ih = this.head();
				if (ih.major !== 0 && ih.major !== 1) this.fail("an Instant must be an integer");
				return new Instant(this.intAfter(ih));
			}
		}
		this.pos = start;
		return this.fail(`an unknown tag ${h.arg}`);
	}

	simpleAfter(h: Head, start: number): Value {
		switch (h.info) {
			case 20:
				return false;
			case 21:
				return true;
			case 22:
				return null;
			case 25:
				return fromHalf(Number(h.arg));
			case 26: {
				const v = new DataView(new ArrayBuffer(4));
				v.setUint32(0, Number(h.arg));
				return v.getFloat32(0);
			}
			case 27: {
				const v = new DataView(new ArrayBuffer(8));
				v.setBigUint64(0, h.arg);
				return v.getFloat64(0);
			}
		}
		this.pos = start;
		return this.fail(
			h.info === 23 ? "undefined is not a tdata value" : "an unsupported simple value",
		);
	}

	message(): Message {
		const h = this.head();
		if (h.major !== 5) this.fail("a message must be a map");
		const n = this.length(h);
		const seen = new Set<string>();
		let id: string | undefined;
		let kind: string | undefined;
		let data: Value | undefined;
		let hasData = false;
		let children: Message[] | undefined;
		let meta: Meta = new Map();
		for (let i = 0; i < n; i++) {
			const k = this.text("a message key");
			if (seen.has(k)) this.fail(`a duplicate key ${JSON.stringify(k)}`);
			seen.add(k);
			switch (k) {
				case "id":
					id = this.text("a message id");
					break;
				case "kind":
					kind = this.text("a message kind");
					break;
				case "data":
					data = this.value();
					hasData = true;
					break;
				case "messages": {
					const ah = this.head();
					if (ah.major !== 4) this.fail("messages must be an array");
					const count = this.length(ah);
					children = [];
					for (let j = 0; j < count; j++) children.push(this.message());
					break;
				}
				case "meta":
					meta = this.meta();
					break;
				default:
					this.fail(`an unknown message key ${JSON.stringify(k)}`);
			}
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
		const h = this.head();
		if (h.major !== 5) this.fail("meta must be a map");
		const n = this.length(h);
		const m: Meta = new Map();
		for (let i = 0; i < n; i++) {
			const uri = this.text("a dialect URI");
			if (m.has(uri)) this.fail(`a duplicate dialect ${JSON.stringify(uri)}`);
			const headers = this.map("a dialect's headers");
			for (const [k, v] of headers)
				if (!isScalar(v)) this.fail(`header ${JSON.stringify(k)} is not a Scalar`);
			m.set(uri, headers as Map<string, Scalar>);
		}
		return m;
	}
}

export const toHex = (b: Uint8Array): string => b.toHex();
export const fromHex = (s: string): Uint8Array => Uint8Array.fromHex(s);
