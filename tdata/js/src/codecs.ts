// Codecs bind a type_id to a native JS representation (docs/spec.md §1.3). Decoding a Typed
// with no codec, or one the codec rejects, keeps the Typed: application types never make
// decoding fail, and a Typed that stays a Typed re-encodes as it came.

import { kindOf, Typed, type Value } from "./model.ts";

export interface Codec<N = unknown> {
	/** The type_id the native travels under. */
	typeId: string;
	/** Whether `x` is a native this codec encodes. */
	is(x: unknown): x is N;
	/** The native's payload: the wire view is Typed(typeId, encode(native)). */
	encode(native: N): Value;
	/** The native for a payload, or undefined to reject it (the Typed is kept). */
	decode(value: Value): N | undefined;
}

export class Codecs {
	#byTypeId = new Map<string, Codec>();
	#all: Codec[] = [];

	constructor(codecs: Iterable<Codec<unknown>> = []) {
		for (const c of codecs) this.register(c);
	}

	register<N>(codec: Codec<N>): this {
		const c = codec as unknown as Codec;
		const old = this.#byTypeId.get(c.typeId);
		if (old) this.#all.splice(this.#all.indexOf(old), 1);
		this.#byTypeId.set(c.typeId, c);
		this.#all.push(c);
		return this;
	}

	get(typeId: string): Codec | undefined {
		return this.#byTypeId.get(typeId);
	}

	/** The codec that encodes `x`, for a value that isn't a tdata value. */
	forNative(x: unknown): Codec | undefined {
		for (const c of this.#all) if (c.is(x)) return c;
		return undefined;
	}

	/** A decoded Typed as its native, or the Typed itself when no codec takes it. */
	decodeTyped(t: Typed): unknown {
		const c = this.#byTypeId.get(t.typeId);
		if (!c) return t;
		let native: unknown;
		try {
			native = c.decode(t.value);
		} catch {
			return t;
		}
		return native === undefined ? t : native;
	}

	/** The wire view of a native, or undefined if no codec takes it. */
	wireView(x: unknown): Typed | undefined {
		const c = this.forNative(x);
		return c ? new Typed(c.typeId, c.encode(x)) : undefined;
	}
}

export const noCodecs = new Codecs();

/** `x` as a tdata value: itself when it is one, its wire view when it's a native. */
export const asValue = (x: unknown, codecs: Codecs = noCodecs): Value | undefined => {
	if (kindOf(x) !== undefined) return x as Value;
	return codecs.wireView(x);
};
