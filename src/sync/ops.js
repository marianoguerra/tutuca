// Engine-neutral changes to a state, by path over its plain projection:
//   { op: "set", path, value }                 value is plain data, path [] replaces the root
//   { op: "delete", path }                     a record or map key
//   { op: "insert", path, index, values }      into the array at path
//   { op: "remove", path, index, count }       from the array at path
//   { op: "text", path, index, remove, insert } splices the string at path
import { truncate } from "../core/host/text.js";
import { jsonText, pathText } from "../tree/index.js";

// An op whose path or index isn't in the state: it was made against a different version.
export class OpConflictError extends Error {}

// obj[key] = value as an own property, "__proto__" included: a map key is data.
export const setOwn = (obj, key, value) => {
	if (key === "__proto__") {
		Object.defineProperty(obj, key, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	} else obj[key] = value;
	return obj;
};

const isContainer = (v) => v !== null && typeof v === "object";
const isCount = (n) => Number.isInteger(n) && n >= 0;
// Whether container holds key as its own: an index in range or an own property.
const holds = (v, key) =>
	Array.isArray(v)
		? isCount(key) && key < v.length
		: typeof key === "string" && Object.hasOwn(v, key);
// The value at path, through own keys only, or undefined where it isn't there.
const valueAt = (root, path) => {
	let v = root;
	for (const key of path) {
		if (!isContainer(v) || !holds(v, key)) return undefined;
		v = v[key];
	}
	return v;
};
const isString = (v) => typeof v === "string";

// Why op doesn't apply to root, or null when it does. isText(value) tells the values a text
// op splices: strings in a plain projection, an engine's own text type in its document.
export const opFits = (root, op, { isText = isString } = {}) => {
	const { path } = op;
	if (!Array.isArray(path)) return "the op has no path";
	const missing = (p) => `there is no ${p.length === 0 ? "root" : pathText(p)}`;
	const notContainer = (p) =>
		valueAt(root, p) === undefined ? missing(p) : `${pathText(p)} isn't a record or array`;
	const target = valueAt(root, path);
	const notArray = "the value there isn't an array";
	const outOfRange = `index ${String(op.index)} is out of range`;
	switch (op.op) {
		case "set": {
			if (path.length === 0) return null;
			const parent = valueAt(root, path.slice(0, -1));
			if (!isContainer(parent)) return notContainer(path.slice(0, -1));
			const key = path.at(-1);
			if (Array.isArray(parent))
				return holds(parent, key) ? null : `index ${String(key)} is out of range`;
			return isString(key) ? null : `key ${String(key)} isn't a string`;
		}
		case "delete": {
			const parent = valueAt(root, path.slice(0, -1));
			if (!isContainer(parent) || Array.isArray(parent)) return "its parent isn't a record";
			return holds(parent, path.at(-1)) ? null : missing(path);
		}
		case "insert":
			if (!Array.isArray(target)) return notArray;
			if (!Array.isArray(op.values)) return "the op has no values";
			return isCount(op.index) && op.index <= target.length ? null : outOfRange;
		case "remove":
			if (!Array.isArray(target)) return notArray;
			return isCount(op.index) && isCount(op.count) && op.index + op.count <= target.length
				? null
				: outOfRange;
		case "text":
			if (!isText(target)) return "the value there isn't text";
			if (!isString(op.insert)) return "the op has no text to insert";
			return isCount(op.index) && isCount(op.remove) && op.index + op.remove <= target.length
				? null
				: outOfRange;
		default:
			return `unknown op ${String(op.op)}`;
	}
};

// Applies op, which fits root, in place; returns the root, or the new one a set at [] made.
const applyOp = (root, op, adopt) => {
	const { path } = op;
	const parent = () => valueAt(root, path.slice(0, -1));
	switch (op.op) {
		case "set":
			if (path.length === 0) return adopt(op.value, path, root);
			setOwn(parent(), path.at(-1), adopt(op.value, path, root));
			break;
		case "delete":
			delete parent()[path.at(-1)];
			break;
		case "insert": {
			const values = op.values.map((v, i) => adopt(v, [...path, op.index + i], root));
			valueAt(root, path).splice(op.index, 0, ...values);
			break;
		}
		case "remove":
			valueAt(root, path).splice(op.index, op.count);
			break;
		case "text": {
			const s = valueAt(root, path);
			setOwn(
				parent(),
				path.at(-1),
				s.slice(0, op.index) + op.insert + s.slice(op.index + op.remove),
			);
			break;
		}
	}
	return root;
};
// Applies ops to root in place and returns it, or the new root a set at [] made. adopt turns an
// op's plain value into a state value for the path it goes to: hydrate for a state, a copy for
// a plain mirror. Throws OpConflictError, before changing anything, for an op that doesn't fit.
export const applyOps = (root, ops, adopt = (value) => structuredClone(value)) => {
	for (const op of ops) {
		const reason = opFits(root, op);
		if (reason !== null) {
			const where = Array.isArray(op.path) ? ` at ${pathText(op.path)}` : "";
			throw new OpConflictError(`${String(op.op)}${where}: ${reason}`);
		}
		root = applyOp(root, op, adopt);
	}
	return root;
};

const valueText = (value, max = 60) => truncate(jsonText(value), max);
// An op as a line for people to read.
export const opText = (op) => {
	const where = pathText(op.path);
	switch (op.op) {
		case "set":
			return `set ${where} to ${valueText(op.value)}`;
		case "delete":
			return `delete ${where}`;
		case "insert":
			return `insert ${op.values.map((v) => valueText(v, 40)).join(", ")} into ${where} at ${op.index}`;
		case "remove":
			return `remove ${op.count} from ${where} at ${op.index}`;
		case "text": {
			const removed = op.remove > 0 ? `remove ${op.remove} characters` : "";
			const inserted = op.insert !== "" ? `insert ${valueText(op.insert)}` : "";
			return `in ${where} at ${op.index}: ${[removed, inserted].filter(Boolean).join(", ")}`;
		}
		default:
			return `${op.op} ${where}`;
	}
};
