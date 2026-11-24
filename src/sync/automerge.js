// A sync engine that keeps the shared fields in an Automerge document, so peers that sync it
// (through automerge-repo, or by exchanging changes) merge their edits. StringType fields are
// collaborative text; every other string is stored as an ImmutableString.
//
// handle: an automerge-repo DocHandle, or docHandle(doc) for a document without a repo.
import * as A from "@automerge/automerge";
import { StringType } from "../core/model/types.js";
import { getIn, keyType, narrow, typeAt } from "./codec.js";
import { diff } from "./diff.js";
import { applyProjection, applyStateOps, opsOf, rootOps } from "./engine.js";
import { writeFitting } from "./migrate.js";
import { setOwn } from "./ops.js";

const leaf = (v) => (v instanceof A.ImmutableString ? v.val : v instanceof A.Counter ? v.value : v);
// A document's value as plain data.
export const fromDoc = (v) => {
	const l = leaf(v);
	if (l !== v || v === null || typeof v !== "object") return l;
	if (Array.isArray(v)) return v.map(fromDoc);
	const out = {};
	for (const key of Object.keys(v)) setOwn(out, key, fromDoc(v[key]));
	return out;
};
// The document's key for the components defined at runtime (pure/definitions.js), beside the
// state's projection: { ref: source }, one flat map so that two peers adding to it at once both
// land (a map made at the same key by both would keep only one's). Sources are atomic strings:
// two edits of a module at once keep one, not a merge of both.
export const DEFINITIONS = "$definitions";
// The state's projection in a document: its plain data without the definitions.
const stateOf = (doc) => {
	const plain = fromDoc(doc);
	delete plain[DEFINITIONS];
	return plain;
};
// The definitions a document holds, { ref: source }.
const definitionsOf = (doc) => (doc?.[DEFINITIONS] ? fromDoc(doc[DEFINITIONS]) : {});
const sameDefinitions = (a, b) => {
	const ka = Object.keys(a);
	return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
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
	for (const key of Object.keys(v)) {
		// A component's $ has no type, which keeps the ref an ImmutableString.
		setOwn(out, key, toDoc(v[key], keyType(type, v, key, "shared", rootScope), rootScope));
	}
	return out;
};
// Text in a document is a string; every other string is an ImmutableString.
const isText = (v) => typeof v === "string";
// Writes op, made against next, into the change proxy d.
const writeOp = (d, op, next, scope) => {
	const { path } = op;
	const parent = () => getIn(d, path.slice(0, -1));
	const typeOf = (p) => typeAt(next, p, scope, "shared").type;
	switch (op.op) {
		case "set": {
			const value = toDoc(op.value, typeOf(path), scope);
			if (path.length > 0) parent()[path.at(-1)] = value;
			else {
				for (const key of Object.keys(d)) if (key !== DEFINITIONS) delete d[key];
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
	return d;
};

// definitions: a definitionsRegistry (pure/definitions.js) whose entries the document shares
// with its peers, or null to share none.
export const automergeEngine = ({ handle, definitions = null }) => {
	let link = null;
	let writing = false;
	let unsubscribe = null;
	// What's defined here goes to the document an entry at a time: a removal is that key's
	// delete, which Automerge merges as one (a peer that changed the entry meanwhile keeps it).
	const writeDefinition = ({ op, ref, source }) => {
		writing = true;
		try {
			handle.change((d) => {
				if (op === "put") {
					d[DEFINITIONS] ??= {};
					d[DEFINITIONS][ref] = new A.ImmutableString(source);
				} else if (d[DEFINITIONS] && Object.hasOwn(d[DEFINITIONS], ref)) {
					delete d[DEFINITIONS][ref];
				}
			});
		} finally {
			writing = false;
		}
	};
	let loaded = null; // the document load read, to catch what changed before attach
	const onMigrate = (report) => link.report("migrated", report);
	const onChange = ({ patchInfo }) => {
		if (writing || link === null) return;
		onStateChange(patchInfo);
		// After the state: what a peer defined makes the UnknownComponents of it the real ones.
		const defs = definitionsOf(patchInfo.after);
		if (definitions !== null && !sameDefinitions(definitionsOf(patchInfo.before), defs)) {
			definitions.receive(defs);
		}
	};
	const onStateChange = (patchInfo) => {
		const { scope } = link.host;
		try {
			const ops = diff(patchInfo.before, patchInfo.after, { scope, leaf, plain: fromDoc });
			if (ops.length === 0) return;
			link.apply((root) => applyStateOps(root, ops, scope, { onMigrate }), patchInfo);
		} catch (error) {
			// The state and the document parted ways: bring the state to the document whole.
			link.report("syncFailed", { error });
			try {
				applyProjection(link, stateOf(patchInfo.after), { onMigrate, info: patchInfo });
			} catch (resyncError) {
				// Not even whole: the state stays as it is, and says so, until a change fits.
				link.report("syncFailed", { error: resyncError, resync: true });
			}
		}
	};
	// Writes ops of the change to next into the document, made to fit it (writeFitting).
	const write = (ops, next) => {
		const { scope } = link.host;
		writing = true;
		try {
			handle.change((d) => {
				const options = { scope, leaf, isText, write: (c, op) => writeOp(c, op, next, scope) };
				writeFitting(d, ops, next, options);
			});
		} finally {
			writing = false;
		}
	};
	const engine = {
		name: "automerge",
		level: "shared",
		load() {
			const doc = handle.doc();
			loaded = doc ?? null;
			// Before the state: what peers defined, so it's made with their components.
			definitions?.receive(definitionsOf(doc));
			return doc === undefined || doc.$ === undefined ? null : stateOf(doc);
		},
		attach(l) {
			link = l;
			const doc = handle.doc();
			// An empty document starts from this root; one that changed since load (or that load
			// didn't read) brings the state to it.
			if (doc?.$ === undefined) write(rootOps(l.root(), "shared"), l.root());
			else if (doc !== loaded) {
				definitions?.receive(definitionsOf(doc));
				applyProjection(l, stateOf(doc), { onMigrate, info: { attach: true } });
			}
			loaded = null;
			handle.on("change", onChange);
			unsubscribe = definitions?.subscribe(writeDefinition) ?? null;
		},
		prepare: (change) => opsOf(change, "shared", link.host.scope),
		commit(change, ops) {
			if (ops.length > 0) write(ops, change.next);
		},
		detach() {
			handle.off("change", onChange);
			unsubscribe?.();
			unsubscribe = null;
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
