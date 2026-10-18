// A sync engine that keeps the shared fields in an Automerge document, so peers that sync it
// (through automerge-repo, or by exchanging changes) merge their edits. StringType fields are
// collaborative text; every other string is stored as an ImmutableString.
//
// handle: an automerge-repo DocHandle, or docHandle(doc) for a document without a repo.
import * as A from "@automerge/automerge";
import { StringType } from "../schema.js";
import { componentOf, getIn, keyType, narrow, typeAt } from "./codec.js";
import { diff } from "./diff.js";
import { applyStateOps, opsOf } from "./index.js";

const leaf = (v) => (v instanceof A.ImmutableString ? v.val : v instanceof A.Counter ? v.value : v);
// A document's value as plain data.
export const fromDoc = (v) => {
	const l = leaf(v);
	if (l !== v || v === null || typeof v !== "object") return l;
	if (Array.isArray(v)) return v.map(fromDoc);
	const out = {};
	for (const key of Object.keys(v)) out[key] = fromDoc(v[key]);
	return out;
};
// Plain data of type as a document value: strings are text only where the schema says so.
const toDoc = (v, type, rootScope) => {
	if (typeof v === "string") {
		return narrow(type, v) instanceof StringType ? v : new A.ImmutableString(v);
	}
	if (v === null || typeof v !== "object") return v;
	if (Array.isArray(v))
		return v.map((item) => toDoc(item, keyType(type, v, 0, "shared", rootScope), rootScope));
	const out = {};
	const isComponent = componentOf(v, rootScope, type) !== null;
	for (const key of Object.keys(v)) {
		const t = key === "$" && isComponent ? null : keyType(type, v, key, "shared", rootScope);
		out[key] = toDoc(v[key], t, rootScope); // a null type keeps the ref an ImmutableString
	}
	return out;
};
// Writes ops, made against next, into the change proxy d.
const writeOps = (d, ops, next, scope) => {
	for (const op of ops) {
		const { path } = op;
		const parent = () => getIn(d, path.slice(0, -1));
		const typeOf = (p) => typeAt(next, p, scope, "shared").type;
		switch (op.op) {
			case "set": {
				const value = toDoc(op.value, typeOf(path), scope);
				if (path.length > 0) parent()[path.at(-1)] = value;
				else {
					for (const key of Object.keys(d)) delete d[key];
					Object.assign(d, value);
				}
				break;
			}
			case "delete":
				delete parent()[path.at(-1)];
				break;
			case "insert": {
				const values = op.values.map((v, i) => toDoc(v, typeOf([...path, op.index + i]), scope));
				getIn(d, path).insertAt(op.index, ...values);
				break;
			}
			case "remove":
				getIn(d, path).deleteAt(op.index, op.count);
				break;
			case "text":
				A.splice(d, path, op.index, op.remove, op.insert);
				break;
		}
	}
};

export const automergeEngine = ({ handle }) => {
	let link = null;
	let writing = false;
	const onChange = ({ patchInfo }) => {
		if (writing || link === null) return;
		const { scope } = link.host;
		const ops = diff(patchInfo.before, patchInfo.after, { scope, leaf, plain: fromDoc });
		if (ops.length === 0) return;
		const onMigrate = (report) => link.host.notify("stateMigrated", { engine, ...report });
		link.apply((root) => applyStateOps(root, ops, scope, { onMigrate }), patchInfo);
	};
	const write = (fn) => {
		writing = true;
		try {
			handle.change(fn);
		} finally {
			writing = false;
		}
	};
	const engine = {
		level: "shared",
		handle,
		load() {
			const doc = handle.doc();
			return doc === undefined || doc.$ === undefined ? null : fromDoc(doc);
		},
		attach(l) {
			link = l;
			const { scope } = l.host;
			// An empty document starts from this root.
			if (handle.doc()?.$ === undefined) {
				const set = opsOf({ prev: undefined, next: l.root(), task: null }, "shared", scope);
				write((d) => writeOps(d, set, l.root(), scope));
			}
			handle.on("change", onChange);
		},
		commit(change) {
			const { scope } = link.host;
			const ops = opsOf(change, "shared", scope);
			if (ops.length > 0) write((d) => writeOps(d, ops, change.next, scope));
		},
		detach() {
			handle.off("change", onChange);
			link = null;
		},
	};
	return engine;
};

// A handle over a document without a repo: change it here, and merge(other) or
// applyChanges(changes) bring in what peers did.
export const docHandle = (doc = A.init()) => {
	const listeners = new Set();
	const update = (fn) => {
		const before = doc;
		doc = fn(doc);
		if (doc === before) return;
		const patchInfo = { before, after: doc, source: "change" };
		for (const listener of listeners) listener({ doc, patchInfo });
	};
	return {
		doc: () => doc,
		change: (fn) => update((d) => A.change(d, fn)),
		merge: (other) => update((d) => A.merge(d, other)),
		applyChanges: (changes) => update((d) => A.applyChanges(d, changes)[0]),
		on: (event, fn) => event === "change" && listeners.add(fn),
		off: (event, fn) => event === "change" && listeners.delete(fn),
	};
};
