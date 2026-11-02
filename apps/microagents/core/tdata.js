// tdata and tq for the micro-agents, from the vendored bundle (scripts/vendor.js tdata), plus
// the conversions between tdata Values and plain JSON that agents work with.
import * as tdata from "../../../demos/deps/tdata.js";

export * from "../../../demos/deps/tdata.js";

// The query engine every agent's tq query runs on.
export const queries = new tdata.Query(tdata.tqEngine);

const kindName = (v) => tdata.kindOf(v) ?? typeof v;

// A Value as plain JSON: Ints become numbers, Objects plain objects, Sets arrays. Values JSON
// has no form for (Bytes, Instant, Ref, Typed, Node) throw, saying where.
export const toJson = (value, path = "") => {
	if (value === null || typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "bigint") {
		const n = Number(value);
		if (!Number.isSafeInteger(n))
			throw new tdata.TdataError(`${path || "the value"}: ${value} is too large for JSON`);
		return n;
	}
	if (typeof value === "number") return value;
	if (Array.isArray(value)) return value.map((v, i) => toJson(v, `${path}[${i}]`));
	if (value instanceof Set) return [...value].map((v, i) => toJson(v, `${path}[${i}]`));
	if (value instanceof Map) {
		const out = {};
		for (const [k, v] of value) out[k] = toJson(v, `${path}.${k}`);
		return out;
	}
	throw new tdata.TdataError(`${path || "the value"}: a ${kindName(value)} has no plain JSON form`);
};

// Plain JSON as a Value: whole numbers become Ints (JSON.parse can't tell 1 from 1.0), objects
// Objects in their key order.
export const fromJson = (json) => {
	if (typeof json === "number") return Number.isInteger(json) ? BigInt(json) : json;
	if (Array.isArray(json)) return json.map(fromJson);
	if (json !== null && typeof json === "object") {
		return new Map(Object.entries(json).map(([k, v]) => [k, fromJson(v)]));
	}
	return json;
};

// A message's data as plain JSON, or fallback when it has none or it has no JSON form.
export const dataJson = (msg, fallback = null) => {
	if (msg?.data === undefined) return fallback;
	try {
		return toJson(msg.data);
	} catch {
		return fallback;
	}
};

// The headers of a message's meta dialect as a plain object.
export const headers = (msg, dialect) => {
	const h = msg?.meta?.get(dialect);
	return h === undefined ? {} : Object.fromEntries([...h].map(([k, v]) => [k, toJson(v)]));
};

// Reads tdata JSON text or CBOR bytes, by the file name, then by sniffing: text that starts with
// "{" is JSON.
export const decodeFile = ({ name = "", text, bytes }) => {
	if (text !== undefined) return tdata.decodeMessage(text);
	const isCbor = /\.cbor$/i.test(name) || bytes[0] !== 0x7b;
	return isCbor
		? tdata.decodeMessageCbor(bytes)
		: tdata.decodeMessage(new TextDecoder().decode(bytes));
};
