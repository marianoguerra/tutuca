// jsonpointer-lab: RFC 6901 JSON Pointers resolved in one JSON document. For each pointer the
// page shows the value it reaches or why it reaches nothing, and the document as a tree:
// clicking a node puts its pointer in the focused pointer. The document is edited as JSON text,
// kept while it doesn't parse. The root's messages are the agent's tools; the rows' inputs send
// messages of their own, by the row's key. It has no host module: the pointers resolve here.
import type { MicroAgent } from "../../kit/kit.tutuca";
import {
	button,
	div,
	each,
	field,
	h,
	h2,
	h3,
	header,
	pre,
	send,
	sourceKey,
	span,
	targetValue,
	textarea,
	when,
} from "tutuca/view";
import { get, itemsOf, keysOf, kindOf, parseJson, range, toJson } from "tutuca/data";

/** A pointer, with the id the model names it by (q1, q2, …). */
export type PointerRow = { id: string; pointer: string };
/** Where a pointer leads: the value it reaches, or the segment where it fails and why (error:
 * why the document can't be used). */
export type Resolution = { resolves: boolean; tokens: string[]; value: unknown; segment: number; reason: string; error: string };
/** A node of the document's tree, depth first. */
export type TreeNode = { pointer: string; depth: number; key: string; text: string; type: string; value: unknown };
/** A node still to walk. */
export type Work = { value: unknown; at: string; key: string; depth: number };

// The most tree rows the page shows, and the most nodes find answers with.
const MAX_ROWS = 1500;
const MAX_FOUND = 50;
const CLIP_AT = 80;

/** text cut to at most n characters, with … when it was longer. */
function clip(text: string, n: number): string {
	return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
}

/** A value as one line of JSON, clipped. */
function preview(v: unknown): string {
	return clip(toJson(v, 0), CLIP_AT);
}

/** A key as a reference token: ~ written ~0 and / written ~1. */
function escapeKey(key: string): string {
	return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** What JSON calls the type of v. */
function jsonType(v: unknown): string {
	const k = kindOf(v);
	if (k === "list") return "array";
	if (k === "object") return "object";
	if (k === "string") return "string";
	if (k === "number") return "number";
	if (k === "boolean") return "boolean";
	return "null";
}

/** Every node of doc, depth first, at most max: a work list, the next node last. */
function nodesOf(doc: unknown, max: number): TreeNode[] {
	const out: TreeNode[] = [];
	let work: Work[] = [{ value: doc, at: "", key: "(root)", depth: 0 }];
	for (const _ of range(0, max)) {
		const top = work[work.length - 1];
		if (top === undefined) break;
		work = work.slice(0, work.length - 1);
		const v = top.value;
		const kind = kindOf(v);
		const items = itemsOf(v);
		const keys = keysOf(v);
		const shown = kind === "list" ? `[${items.length} items]` : kind === "object" ? `{${keys.length} keys}` : toJson(v, 0);
		out.push({ pointer: top.at, depth: top.depth, key: top.key, text: clip(shown, CLIP_AT), type: jsonType(v), value: v });
		if (kind === "list") {
			for (const j of range(0, items.length)) {
				const i = items.length - 1 - j;
				work.push({ value: items[i], at: `${top.at}/${i}`, key: `${i}`, depth: top.depth + 1 });
			}
		}
		if (kind === "object") {
			for (const j of range(0, keys.length)) {
				const name = keys[keys.length - 1 - j] ?? "";
				work.push({ value: get(v, name), at: `${top.at}/${escapeKey(name)}`, key: toJson(name, 0), depth: top.depth + 1 });
			}
		}
	}
	return out;
}

/** Whether token is an array index: 0, or digits not starting with 0. */
function isIndex(token: string): boolean {
	if (token.length === 0) return false;
	if (token.length > 1 && token.startsWith("0")) return false;
	for (const i of range(0, token.length)) {
		const c = token.slice(i, i + 1);
		if (c < "0" || c > "9") return false;
	}
	return true;
}

/** Whether raw has a ~ not followed by 0 or 1. */
function badTilde(raw: string): boolean {
	for (const i of range(0, raw.length)) {
		if (raw.slice(i, i + 1) !== "~") continue;
		const after = raw.slice(i + 1, i + 2);
		if (after !== "0" && after !== "1") return true;
	}
	return false;
}

/** An object's first 8 keys, quoted, with … when it has more. */
function someKeys(v: unknown): string {
	const keys = keysOf(v);
	const shown = keys.slice(0, 8).map((k) => toJson(k, 0));
	if (keys.length > 8) shown.push("…");
	return shown.join(", ");
}

function failed(tokens: readonly string[], segment: number, reason: string): Resolution {
	return { resolves: false, tokens: tokens.map((t) => t), value: null, segment, reason, error: "" };
}

function failedAt(tokens: readonly string[], i: number, reason: string): Resolution {
	return failed(tokens, i + 1, `segment ${i + 1}: ${reason}`);
}

/** Where pointer leads in doc. */
function resolveIn(doc: unknown, pointer: string): Resolution {
	const tokens: string[] = [];
	if (pointer !== "") {
		if (!pointer.startsWith("/")) return failed(tokens, 0, 'a pointer is "" or starts with "/"');
		const raws = pointer.slice(1).split("/");
		for (const i of range(0, raws.length)) {
			const raw = raws[i] ?? "";
			if (badTilde(raw)) {
				return failed(tokens, i + 1, `segment ${i + 1} ${toJson(raw, 0)} has a ~ that isn't ~0 (for ~) or ~1 (for /)`);
			}
			tokens.push(raw.replaceAll("~1", "/").replaceAll("~0", "~"));
		}
	}
	let at: unknown = doc;
	for (const i of range(0, tokens.length)) {
		const token = tokens[i] ?? "";
		const kind = kindOf(at);
		if (kind === "list") {
			const items = itemsOf(at);
			const n = items.length;
			if (token === "-") return failedAt(tokens, i, '"-" names the item after the last one, which doesn\'t exist');
			if (!isIndex(token)) return failedAt(tokens, i, `${toJson(token, 0)} isn't an array index (the array has ${n} items)`);
			const index = Number(token);
			if (index >= n) return failedAt(tokens, i, `index ${token} is out of range (the array has ${n} items)`);
			at = items[index];
		} else if (kind === "object") {
			const got = get(at, token);
			if (kindOf(got) === "undefined") {
				return failedAt(tokens, i, `the object has no key ${toJson(token, 0)} (its keys: ${someKeys(at)})`);
			}
			at = got;
		} else return failedAt(tokens, i, `can't look up ${toJson(token, 0)} in a ${jsonType(at)}`);
	}
	return { resolves: true, tokens, value: at, segment: 0, reason: "", error: "" };
}

/** A resolution as the tools answer it: { resolves, tokens, value }, { resolves, tokens,
 * segment, reason }, or { resolves, error }. */
function answerOf(r: Readonly<Resolution>): unknown {
	if (r.error !== "") return { resolves: false, error: r.error };
	if (r.resolves) return { resolves: true, tokens: r.tokens, value: r.value };
	return { resolves: false, tokens: r.tokens, segment: r.segment, reason: r.reason };
}

/** Why a resolution reaches nothing: its reason, or the document's error. */
function why(r: Readonly<Resolution>): string {
	return r.error !== "" ? r.error : r.reason;
}

/** What a resolution says in one line: the value's preview or why there's none. */
function outcome(r: Readonly<Resolution>): string {
	return r.resolves ? preview(r.value) : why(r);
}

/** The first of prefix1, prefix2, … that no item's id is, from the count up. */
function nextId(ids: readonly string[], prefix: string): string {
	for (const n of range(ids.length + 1, 2 * ids.length + 2)) {
		const id = `${prefix}${n}`;
		if (!ids.includes(id)) return id;
	}
	return `${prefix}${2 * ids.length + 2}`;
}

/** Where an item at from goes when it's moved to to: the order of the indexes, kept within the
 * list. */
function movedOrder(length: number, from: number, to: number): number[] {
	const rest = range(0, length).filter((j) => j !== from);
	const at = Math.max(0, Math.min(to, rest.length));
	const out: number[] = [];
	for (const j of range(0, rest.length)) {
		if (j === at) out.push(from);
		out.push(rest[j] ?? 0);
	}
	if (at >= rest.length) out.push(from);
	return out;
}

export type JsonPointerLab = {
	/** The pointers, each with an id the model names it by (q1, q2, …). */
	pointers: PointerRow[];
	/** The JSON document the pointers resolve in. */
	document: unknown;
	/** The document as the user edits it; "" until it's edited. */
	docText: string;
	/** Why docText isn't JSON; "" when it is (and document is its value). */
	docError: string;
	/** The pointer a click in the tree sets; "" for the first. */
	focus: string;
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	/** The document as JSON text, as the editor shows it. */
	readonly editorText: string;
	/** Every pointer's resolution. */
	readonly resolutions: unknown;
	readonly resolutionRows: { id: string; resolves: boolean; status: string; text: string }[];
	readonly headline: string;
	readonly focusLabel: string;
	/** What the focused pointer reaches, as JSON text, or why it reaches nothing. */
	readonly focusValue: string;
	readonly treeRows: { key: string; text: string; pointer: string; style: string; on: boolean }[];
	/** Each pointer's resolution, in order (the document's error when it isn't JSON). */
	readonly resolved: Resolution[];
	/** The document's nodes, depth first (none while it isn't JSON). */
	readonly nodes: TreeNode[];
};

export const JsonPointerLab = {
	implements: ["MicroAgent"],
	defaults: { document: null, docText: "", docError: "", focus: "" },
	constraints: { pointers: { minLength: 1 } },
	queries: {
		get resolved(): Resolution[] {
			return this.pointers.map((row) => {
				if (this.docError === "") return resolveIn(this.document, row.pointer);
				const none: string[] = [];
				return { resolves: false, tokens: none, value: null, segment: 0, reason: "", error: `document: not JSON: ${this.docError}` };
			});
		},
		get nodes(): TreeNode[] {
			if (this.docError !== "") {
				const none: TreeNode[] = [];
				return none;
			}
			return nodesOf(this.document, MAX_ROWS);
		},
		get resolutions(): unknown {
			const rs = this.resolved;
			const out: unknown[] = [];
			for (const i of range(0, this.pointers.length)) {
				const row = this.pointers[i];
				const r = rs[i];
				if (row === undefined || r === undefined) continue;
				if (r.error !== "") out.push({ resolves: false, error: r.error, id: row.id, pointer: row.pointer });
				else if (r.resolves) out.push({ resolves: true, tokens: r.tokens, value: r.value, id: row.id, pointer: row.pointer });
				else out.push({ resolves: false, tokens: r.tokens, segment: r.segment, reason: r.reason, id: row.id, pointer: row.pointer });
			}
			return out;
		},
		get resolutionRows() {
			const rs = this.resolved;
			const out: { id: string; resolves: boolean; status: string; text: string }[] = [];
			for (const i of range(0, this.pointers.length)) {
				const row = this.pointers[i];
				const r = rs[i];
				if (row === undefined || r === undefined) continue;
				out.push({ id: row.id, resolves: r.resolves, status: r.resolves ? "resolves" : "no value", text: outcome(r) });
			}
			return out;
		},
		get headline(): string {
			const n = this.pointers.length;
			const ok = this.resolved.filter((r) => r.resolves).length;
			return `${n} pointers · ${ok} resolve · ${n - ok} don't`;
		},
		get summary(): string {
			const rs = this.resolved;
			const n = this.pointers.length;
			const ok = rs.filter((r) => r.resolves).length;
			const lines = [`${n} pointers: ${ok} resolve, ${n - ok} don't.`, "pointers:"];
			for (const i of range(0, n)) {
				const row = this.pointers[i];
				const r = rs[i];
				if (row === undefined || r === undefined) continue;
				lines.push(`  ${row.id}: ${toJson(row.pointer, 0)} → ${outcome(r)}`);
			}
			lines.push(
				this.docError !== "" ? `document: not JSON: ${this.docError}` : `document: ${clip(toJson(this.document, 0), 400)}`,
			);
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { pointers, document }. */
		get data(): unknown {
			return { pointers: this.pointers, document: this.document };
		},
		get domain(): unknown {
			return { pointers: this.pointers, document: this.document };
		},
		get editorText(): string {
			return this.docText !== "" ? this.docText : toJson(this.document, 2);
		},
		get focusLabel(): string {
			const at = this.pointers.findIndex((row) => row.id === this.focus);
			const row = this.pointers[at < 0 ? 0 : at];
			return row === undefined ? "no pointer" : `${row.id} ${row.pointer}`;
		},
		get focusValue(): string {
			const at = this.pointers.findIndex((row) => row.id === this.focus);
			const r = this.resolved[at < 0 ? 0 : at];
			if (r === undefined) return "";
			return r.resolves ? toJson(r.value, 2) : why(r);
		},
		get treeRows() {
			const at = this.pointers.findIndex((row) => row.id === this.focus);
			const focused = this.pointers[at < 0 ? 0 : at];
			return this.nodes.map((n) => ({
				key: n.key,
				text: n.text,
				pointer: n.pointer === "" ? "(root)" : n.pointer,
				style: `padding-left: ${n.depth * 1.25}rem`,
				on: focused !== undefined && n.pointer === focused.pointer,
			}));
		},
		/** Where any pointer leads in the document: its unescaped tokens, and the value it
		 * reaches, or the segment where it fails and why. */
		resolve(pointer: string): unknown {
			if (this.docError !== "") return { resolves: false, error: `document: not JSON: ${this.docError}` };
			return answerOf(resolveIn(this.document, pointer));
		},
		/** The pointers of nodes whose key or (scalar) value contains a text, ignoring case (at
		 * most 50). */
		find(text: string): unknown {
			const needle = text.toLowerCase();
			let count = 0;
			const found: { pointer: string; type: string }[] = [];
			for (const n of this.nodes) {
				// (a helper's result, named first: tutuca-wax lowers includes on a call's result as a
				// list's.)
				const key: string = n.key.toLowerCase();
				let hit = key.includes(needle);
				const scalar = n.type !== "object" && n.type !== "array";
				if (!hit && scalar) {
					const shown: string = toJson(n.value, 0).toLowerCase();
					hit = shown.includes(needle);
				}
				if (!hit) continue;
				count += 1;
				if (found.length < MAX_FOUND) found.push({ pointer: n.pointer, type: n.type });
			}
			return { count, nodes: found };
		},
	},
	on: {
		/** Change a pointer. */
		setPointer: {
			pure: true,
			changes: ["pointers"],
			pre(prev, [id, pointer]: [string, string]) {
				return this.pointers.some((r) => r.id === id);
			},
			run(next, [id, pointer]: [string, string]) {
				const i = this.pointers.findIndex((r) => r.id === id);
				if (i >= 0) next.pointers[i] = { id, pointer };
			},
		},
		/** Add a pointer; it gets the next free id (q1, q2, …). */
		addPointer: {
			pure: true,
			changes: ["pointers"],
			post(prev, next, [pointer]: [string]) {
				return next.pointers.length === prev.pointers.length + 1;
			},
			run(next, [pointer]: [string]) {
				next.pointers.push({ id: nextId(this.pointers.map((r) => r.id), "q"), pointer });
			},
		},
		/** Remove a pointer. pre is only checked in dev mode: the last pointer stays. */
		removePointer: {
			pure: true,
			changes: ["pointers", "focus"],
			pre(prev, [id]: [string]) {
				return this.pointers.some((r) => r.id === id) && this.pointers.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.pointers.length === prev.pointers.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.pointers.findIndex((r) => r.id === id);
				if (i < 0 || this.pointers.length <= 1) return;
				next.pointers.splice(i, 1);
				if (this.focus === id) next.focus = "";
			},
		},
		/** Move a pointer to a position (0 is first). */
		reorderPointers: {
			pure: true,
			changes: ["pointers"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.pointers.some((r) => r.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.pointers.length === prev.pointers.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.pointers.findIndex((r) => r.id === id);
				if (i < 0) return;
				const order = movedOrder(this.pointers.length, i, index);
				next.pointers = order.map((j) => this.pointers[j] ?? { id: "", pointer: "" });
			},
		},
		/** Replace the JSON document the pointers resolve in. */
		setDocument: {
			pure: true,
			changes: ["document", "docText", "docError"],
			run(next, [document]: [unknown]) {
				next.document = document;
				next.docText = "";
				next.docError = "";
			},
		},
		/** The document's text, from its editor: kept while it isn't JSON. */
		setDocumentText: {
			pure: true,
			changes: ["document", "docText", "docError"],
			run(next, [text]: [string]) {
				const parsed = parseJson(text);
				next.docText = text;
				if (parsed === undefined) {
					next.docError = "the text isn't JSON";
					return;
				}
				next.document = parsed;
				next.docError = "";
			},
		},
		/** Which pointer a click in the tree sets. */
		focus: {
			pure: true,
			changes: ["focus"],
			post(prev, next, [id]: [string]) {
				return next.focus === id;
			},
			run(next, [id]: [string]) {
				next.focus = id;
			},
		},
		/** From the tree: the node at row i's pointer goes in the focused pointer. */
		pickNode: {
			pure: true,
			changes: ["pointers"],
			constraints: { i: { int: true, min: 0 } },
			run(next, [i]: [number]) {
				const node = this.nodes[i];
				if (node === undefined) return;
				const at = this.pointers.findIndex((row) => row.id === this.focus);
				const f = at < 0 ? 0 : at;
				const row = this.pointers[f];
				if (row === undefined) {
					next.pointers.push({ id: nextId(this.pointers.map((r) => r.id), "q"), pointer: node.pointer });
					return;
				}
				next.pointers[f] = { id: row.id, pointer: node.pointer };
			},
		},
		// The rows' own, by the row's key.
		focusAt: {
			pure: true,
			changes: ["focus"],
			constraints: { at: { keyOf: "pointers" } },
			run(next, [at]: [number | null]) {
				const row = at === null ? undefined : this.pointers[at];
				if (row !== undefined) next.focus = row.id;
			},
		},
		setPointerAt: {
			pure: true,
			changes: ["pointers"],
			constraints: { at: { keyOf: "pointers" } },
			run(next, [at, pointer]: [number | null, string]) {
				const row = at === null ? undefined : this.pointers[at];
				if (at !== null && row !== undefined) next.pointers[at] = { id: row.id, pointer };
			},
		},
		removePointerAt: {
			pure: true,
			changes: ["pointers", "focus"],
			constraints: { at: { keyOf: "pointers" } },
			run(next, [at]: [number | null]) {
				const row = at === null ? undefined : this.pointers[at];
				if (at === null || row === undefined || this.pointers.length <= 1) return;
				next.pointers.splice(at, 1);
				if (this.focus === row.id) next.focus = "";
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "JSON Pointer lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Pointers"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("pointers"),
				div(
					{ class: "join w-full" },
					button(
						{
							class: "btn btn-sm join-item font-mono",
							title: "Focus: clicks in the tree set this pointer",
							"on:click": send("focusAt", sourceKey()),
						},
						field("id"),
					),
					h("input", {
						class: "input input-sm input-bordered join-item flex-1 font-mono",
						"aria-label": "JSON Pointer",
						value: field("pointer"),
						"on:input": send("setPointerAt", sourceKey(), targetValue()),
					}),
					button(
						{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removePointerAt", sourceKey()) },
						"✕",
					),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addPointer", "") }, "+ Pointer"),
		),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("resolutionRows"),
				div(
					{ class: "flex items-center gap-2 text-sm" },
					span({ class: "font-mono text-xs opacity-70" }, field("id")),
					span({ class: when(field("resolves"), "badge badge-success", "badge badge-error") }, field("status")),
					span({ class: "font-mono text-xs break-all" }, field("text")),
				),
			),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Value at ", field("focusLabel")),
		pre({ class: "rounded-box bg-base-200 p-2 text-xs max-h-60 overflow-auto" }, field("focusValue")),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Document · click a node to set ", field("focusLabel")),
		div(
			{ class: "flex flex-col rounded-box border border-base-300 p-2 text-sm max-h-96 overflow-auto" },
			each(
				field("treeRows"),
				div(
					{ style: field("style") },
					button(
						{
							class: when(
								field("on"),
								"btn btn-xs btn-warning h-auto justify-start font-mono font-normal normal-case",
								"btn btn-xs btn-ghost h-auto justify-start font-mono font-normal normal-case",
							),
							title: field("pointer"),
							"on:click": send("pickNode", sourceKey()),
						},
						span({ class: "opacity-60" }, field("key")),
						span({}, field("text")),
					),
				),
			),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Document JSON"),
		textarea({
			class: "textarea textarea-bordered w-full font-mono text-xs",
			rows: "8",
			"aria-label": "Document JSON",
			value: field("editorText"),
			"on:input": send("setDocumentText", targetValue()),
		}),
		when(field("docError"), h("p", { class: "text-xs text-error" }, field("docError"))),
	),
};

export const register = { JsonPointerLab: "JsonPointerLab" };
