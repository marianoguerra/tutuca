// Engine-neutral changes to a state, by path over its plain projection:
//   { op: "set", path, value }                 value is plain data, path [] replaces the root
//   { op: "delete", path }                     a record or map key
//   { op: "insert", path, index, values }      into the array at path
//   { op: "remove", path, index, count }       from the array at path
//   { op: "text", path, index, remove, insert } splices the string at path

// An op whose path or index isn't in the state: it was made against a different version.
export class OpConflictError extends Error {}

const at = (root, path, op) => {
	let v = root;
	for (const key of path) {
		if (v === null || typeof v !== "object" || !(key in v)) {
			throw new OpConflictError(`${op.op} at /${op.path.join("/")}: no ${String(key)}`);
		}
		v = v[key];
	}
	return v;
};
const arrayAt = (root, op, end) => {
	const arr = at(root, op.path, op);
	if (!Array.isArray(arr) || op.index < 0 || end > arr.length) {
		throw new OpConflictError(`${op.op} at /${op.path.join("/")}[${op.index}]: out of range`);
	}
	return arr;
};

// Applies ops to root in place and returns it, or the new root a set at [] made. adopt turns an
// op's plain value into a state value for the path it goes to: hydrate for a state, a copy for
// a plain mirror.
export const applyOps = (root, ops, adopt = (value) => structuredClone(value)) => {
	for (const op of ops) {
		const { path } = op;
		switch (op.op) {
			case "set": {
				if (path.length === 0) {
					root = adopt(op.value, path, root);
					break;
				}
				const parent = at(root, path.slice(0, -1), op);
				parent[path.at(-1)] = adopt(op.value, path, root);
				break;
			}
			case "delete": {
				const parent = at(root, path.slice(0, -1), op);
				at(parent, path.slice(-1), op);
				delete parent[path.at(-1)];
				break;
			}
			case "insert": {
				const arr = arrayAt(root, op, op.index);
				const values = [];
				for (const [i, v] of op.values.entries())
					values.push(adopt(v, [...path, op.index + i], root));
				arr.splice(op.index, 0, ...values);
				break;
			}
			case "remove":
				arrayAt(root, op, op.index + op.count).splice(op.index, op.count);
				break;
			case "text": {
				const parent = at(root, path.slice(0, -1), op);
				const s = at(parent, path.slice(-1), op);
				if (typeof s !== "string" || op.index + op.remove > s.length) {
					throw new OpConflictError(`text at /${path.join("/")}: out of range`);
				}
				parent[path.at(-1)] = s.slice(0, op.index) + op.insert + s.slice(op.index + op.remove);
				break;
			}
			default:
				throw new Error(`unknown op ${op.op}`);
		}
	}
	return root;
};

const pathText = (path) =>
	path
		.map((key, i) => (typeof key === "number" ? `[${key}]` : i === 0 ? key : `.${key}`))
		.join("") || "the root";
const valueText = (value, max = 60) => {
	const text = JSON.stringify(value);
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
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
