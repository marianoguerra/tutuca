// tq, the query language (docs/spec.md §6), from JS. The engine is the MoonBit build in
// tdata/mbt (dist/tq.js or dist/tq.wasm, loaded with mbt/load.mjs). Its interface is strings in,
// canonical tdata JSON out; this module converts to and from Messages and Values.

import { decodeValue, encodeMessage, type JsonOptions } from "./json.ts";
import { type Message, type Meta, TdataError, Typed, type Value } from "./model.ts";

/** The functions the MoonBit builds export. */
export interface Engine {
	tq_parse(query: string): string;
	tq_run(query: string, messageJson: string): string;
	tq_match(query: string, messageJson: string): string;
	tq_match_all(query: string, messageJson: string): string;
	tq_canon(messageJson: string): string;
}

/** What a query outputs or binds: a Value, a Message, or a message's child messages. */
export type Found = Value | Message | Message[];

export type Bindings = Map<string, Found>;

/** One output of a query, with the names its patterns bound. */
export interface Solution {
	value: Found;
	bindings: Bindings;
}

/** How the engine writes a message where a Value is expected. */
export const MESSAGE_TYPE_ID = "tdata/message";

export class Query {
	readonly engine: Engine;
	readonly opts: JsonOptions;

	constructor(engine: Engine, opts: JsonOptions = {}) {
		this.engine = engine;
		this.opts = opts;
	}

	/** Throws a TdataError saying where, if `query` doesn't parse. */
	parse(query: string): void {
		this.#result(this.engine.tq_parse(query));
	}

	/** Every output, in order, truthy or not. */
	run(query: string, msg: Message): Solution[] {
		return this.#solutions(this.engine.tq_run(query, this.#encode(msg)));
	}

	/** Every matching output: the ones other than `false` and `null`. */
	matchAll(query: string, msg: Message): Solution[] {
		return this.#solutions(this.engine.tq_match_all(query, this.#encode(msg)));
	}

	/** The first matching output, or undefined when the query doesn't match. */
	match(query: string, msg: Message): Solution | undefined {
		const r = this.#result(this.engine.tq_match(query, this.#encode(msg)));
		return r.get("ok") === true ? solution(r) : undefined;
	}

	test(query: string, msg: Message): boolean {
		return this.match(query, msg) !== undefined;
	}

	#encode(msg: Message): string {
		return encodeMessage(msg, this.opts);
	}

	#result(text: string): Map<string, Value> {
		const r = decodeValue(text, this.opts) as Map<string, Value>;
		const error = r.get("error");
		if (typeof error === "string") throw new TdataError(error);
		return r;
	}

	#solutions(text: string): Solution[] {
		const list = this.#result(text).get("solutions") as Map<string, Value>[];
		return list.map(solution);
	}
}

const solution = (s: Map<string, Value>): Solution => ({
	value: fromWire(s.get("value") as Value),
	bindings: new Map(
		[...(s.get("bindings") as Map<string, Value>)].map(([k, v]) => [k, fromWire(v)]),
	),
});

const isMessageValue = (v: unknown): v is Typed<Map<string, Value>> =>
	v instanceof Typed && v.typeId === MESSAGE_TYPE_ID && v.value instanceof Map;

/** A message the engine wrote as a Value, or an array of them, back as Messages. */
const fromWire = (v: Value): Found => {
	if (isMessageValue(v)) return toMessage(v);
	if (Array.isArray(v) && v.length > 0 && v.every(isMessageValue)) return v.map(toMessage);
	return v;
};

const toMessage = (t: Typed<Map<string, Value>>): Message => {
	const o = t.value;
	const id = o.get("id") as string;
	const kind = o.get("kind") as string;
	const meta = (o.get("meta") ?? new Map()) as Meta;
	const children = o.get("messages");
	if (Array.isArray(children))
		return {
			id,
			kind,
			messages: children.map((c) => toMessage(c as Typed<Map<string, Value>>)),
			meta,
		};
	return { id, kind, data: o.get("data") as Value, meta };
};
