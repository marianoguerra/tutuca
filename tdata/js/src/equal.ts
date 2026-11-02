// Structural equality (docs/spec.md §1.2). Order doesn't count for Objects, attributes, meta and
// Sets; an Int never equals a Double; Doubles compare by bits, with every NaN equal.

import { asValue, type Codecs, noCodecs } from "./codecs.ts";
import { hasMessages, Instant, type Message, type Meta, Node, Ref, Typed } from "./model.ts";

export const equal = (a: unknown, b: unknown, codecs: Codecs = noCodecs): boolean =>
	eq(a, b, codecs);

const eq = (x: unknown, y: unknown, codecs: Codecs): boolean => {
	if (x === y) return typeof x !== "number" || x !== 0 || Object.is(x, y);
	const a = asValue(x, codecs);
	const b = asValue(y, codecs);
	if (a === undefined || b === undefined) return false;
	// Object.is: every NaN equals every NaN, and +0 differs from -0.
	if (typeof a === "number") return typeof b === "number" && Object.is(a, b);
	if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b;
	if (a instanceof Uint8Array) {
		if (!(b instanceof Uint8Array) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}
	if (Array.isArray(a)) return Array.isArray(b) && eqList(a, b, codecs);
	if (a instanceof Map) return b instanceof Map && eqMap(a, b, codecs);
	if (a instanceof Set) {
		if (!(b instanceof Set) || a.size !== b.size) return false;
		const bs = [...b];
		for (const e of a) if (!bs.some((f) => eq(e, f, codecs))) return false;
		const as = [...a];
		for (const f of bs) if (!as.some((e) => eq(e, f, codecs))) return false;
		return true;
	}
	if (a instanceof Typed)
		return b instanceof Typed && a.typeId === b.typeId && eq(a.value, b.value, codecs);
	if (a instanceof Node)
		return (
			b instanceof Node &&
			a.tag === b.tag &&
			eqMap(a.attributes, b.attributes, codecs) &&
			eqList(a.children, b.children, codecs)
		);
	if (a instanceof Instant)
		return b instanceof Instant && a.epochNanoseconds === b.epochNanoseconds;
	if (a instanceof Ref) return b instanceof Ref && a.uri === b.uri;
	return false;
};

const eqList = (a: readonly unknown[], b: readonly unknown[], codecs: Codecs): boolean => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i], codecs)) return false;
	return true;
};

const eqMap = (a: Map<string, unknown>, b: Map<string, unknown>, codecs: Codecs): boolean => {
	if (a.size !== b.size) return false;
	for (const [k, v] of a) {
		if (!b.has(k) || !eq(v, b.get(k), codecs)) return false;
	}
	return true;
};

const eqMeta = (a: Meta, b: Meta): boolean => {
	if (a.size !== b.size) return false;
	for (const [uri, headers] of a) {
		const other = b.get(uri);
		if (!other || !eqMap(headers, other, noCodecs)) return false;
	}
	return true;
};

export const equalMessages = (a: Message, b: Message, codecs: Codecs = noCodecs): boolean => {
	if (a.id !== b.id || a.kind !== b.kind || !eqMeta(a.meta, b.meta)) return false;
	if (hasMessages(a)) {
		if (!hasMessages(b) || a.messages.length !== b.messages.length) return false;
		return a.messages.every((m, i) => equalMessages(m, b.messages[i], codecs));
	}
	return !hasMessages(b) && eq(a.data, b.data, codecs);
};
