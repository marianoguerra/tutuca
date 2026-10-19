// The ops that turn prev into next, guided by their components' schemas. Works on states and on
// plain projections alike (an engine's stored copy), and skips subtrees the two share, so after
// a task it only walks what the task changed.
import { isRecord, StringType } from "../schema.js";
import { componentOf, keysOf, keyType, narrow, project, rootOf } from "./codec.js";

// Past this many cells an array's middle is replaced instead of matched item by item.
const MAX_LCS_CELLS = 1_000_000;
const isHighSurrogate = (s, i) => {
	const c = s.charCodeAt(i);
	return c >= 0xd800 && c <= 0xdbff;
};
// The one splice that turns a into b: their common prefix and suffix stay.
export const textSplice = (a, b) => {
	let start = 0;
	const max = Math.min(a.length, b.length);
	while (start < max && a[start] === b[start]) start++;
	if (start > 0 && isHighSurrogate(a, start - 1)) start--; // don't split a surrogate pair
	let end = 0;
	while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
	if (end > 0 && isHighSurrogate(a, a.length - end - 1)) end--;
	return { index: start, remove: a.length - start - end, insert: b.slice(start, b.length - end) };
};

// The edit script between two arrays as runs: ["keep"] or ["change", removed, inserted].
const sameItem = (a, b) => a === b;
const editRuns = (prev, next) => {
	let head = 0;
	while (head < prev.length && head < next.length && sameItem(prev[head], next[head])) head++;
	let tail = 0;
	while (
		tail < prev.length - head &&
		tail < next.length - head &&
		sameItem(prev[prev.length - 1 - tail], next[next.length - 1 - tail])
	)
		tail++;
	const a = prev.slice(head, prev.length - tail);
	const b = next.slice(head, next.length - tail);
	const runs = [];
	const keep = (n) => {
		for (let i = 0; i < n; i++) runs.push(["keep"]);
	};
	const change = (removed, inserted) => {
		if (removed > 0 || inserted > 0) runs.push(["change", removed, inserted]);
	};
	keep(head);
	if (a.length * b.length > MAX_LCS_CELLS || a.length === 0 || b.length === 0) {
		change(a.length, b.length);
	} else {
		// lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
		const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
		for (let i = a.length - 1; i >= 0; i--) {
			for (let j = b.length - 1; j >= 0; j--) {
				lcs[i][j] = sameItem(a[i], b[j])
					? lcs[i + 1][j + 1] + 1
					: Math.max(lcs[i + 1][j], lcs[i][j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		let removed = 0;
		let inserted = 0;
		while (i < a.length || j < b.length) {
			if (i < a.length && j < b.length && sameItem(a[i], b[j])) {
				change(removed, inserted);
				removed = inserted = 0;
				keep(1);
				i++;
				j++;
			} else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
				inserted++;
				j++;
			} else {
				removed++;
				i++;
			}
		}
		change(removed, inserted);
	}
	keep(tail);
	return runs;
};

// diff options: level, the fields it sees; scope, any scope of the tree (to resolve refs in a
// projection); plain(value, type), the plain data of a value from next for set and insert ops;
// leaf(value), a projection's stored leaf as a JS value (an engine's wrapped strings);
// isText(value), whether a string of prev can take text splices (an engine's text type).
export const diff = (
	prev,
	next,
	{ level = "shared", scope, plain = null, leaf = (v) => v, isText = () => true },
) => {
	const rootScope = rootOf(scope);
	const toPlain = plain ?? ((value, type) => project(value, { level, type }));
	const ops = [];
	const set = (path, value, type) => ops.push({ op: "set", path, value: toPlain(value, type) });
	const walk = (a, b, type, path) => {
		if (a === b) return;
		const la = leaf(a);
		const lb = leaf(b);
		if (la === lb) return;
		if (typeof la === "string" && typeof lb === "string") {
			if (!(narrow(type, lb) instanceof StringType) || !isText(a)) return set(path, b, type);
			return ops.push({ op: "text", path, ...textSplice(la, lb) });
		}
		if (Array.isArray(a) && Array.isArray(b)) return walkArray(a, b, type, path);
		if (!isRecord(a) || !isRecord(b) || la !== a || lb !== b) return set(path, b, type);
		const ca = componentOf(a, rootScope, type);
		const cb = componentOf(b, rootScope, type);
		if (ca?.spec !== cb?.spec || ca?.scope !== cb?.scope) return set(path, b, type);
		const keys = keysOf(b, level, rootScope, type);
		if (cb === null) {
			for (const key of keysOf(a, level, rootScope, type)) {
				if (!Object.hasOwn(b, key)) ops.push({ op: "delete", path: [...path, key] });
			}
		}
		for (const key of keys) {
			const t = keyType(type, b, key, level, rootScope);
			if (t === null) continue;
			if (!Object.hasOwn(a, key)) set([...path, key], b[key], t);
			else walk(a[key], b[key], t, [...path, key]);
		}
	};
	const walkArray = (a, b, type, path) => {
		const itemType = (arr) => keyType(type, arr, 0, level, rootScope) ?? undefined;
		let i = 0; // the index in a as the ops so far changed it
		let ai = 0;
		let bi = 0;
		for (const [kind, removed, inserted] of editRuns(a, b)) {
			if (kind === "keep") {
				i++;
				ai++;
				bi++;
				continue;
			}
			// Items replaced one for one change in place, so their own edits merge.
			const paired = Math.min(removed, inserted);
			for (let k = 0; k < paired; k++) walk(a[ai++], b[bi++], itemType(b), [...path, i++]);
			if (removed > paired) {
				ops.push({ op: "remove", path, index: i, count: removed - paired });
				ai += removed - paired;
			}
			if (inserted > paired) {
				const values = b.slice(bi, bi + inserted - paired).map((v) => toPlain(v, itemType(b)));
				ops.push({ op: "insert", path, index: i, values });
				i += inserted - paired;
				bi += inserted - paired;
			}
		}
	};
	walk(prev, next, undefined, []);
	return ops;
};
