// regex-lab: JavaScript regular expressions run against texts. Each text says, per regex,
// whether it should match ("match") or not ("no-match"); the grid shows which expectations pass.
// The regexes run in the page (microagents/regex, microagents/engines/regex.js). The root's
// messages are the agent's tools; the rows' inputs send messages of their own, by the row's key.
import type { MicroAgent } from "../../kit/kit.tutuca";
import {
	button,
	div,
	each,
	field,
	h2,
	h3,
	header,
	input,
	lookupBind,
	p,
	send,
	sourceKey,
	span,
	targetValue,
	textarea,
	when,
} from "tutuca/view";
import { range, toJson, without } from "tutuca/data";
import { error, matches, segments, test } from "microagents/regex";

/** A regex, with the id the model names it by (r1, r2, …). */
export type Regex = { id: string; pattern: string; flags: string };
/** A text, saying per regex id whether it should match ("match" or "no-match"). */
export type Text = { id: string; text: string; expect: { [key: string]: string } };
export type Outcome = "match" | "no-match" | "none";
/** A cell of the grid: whether the regex matches the text (null when it doesn't compile), what
 * is expected, and whether that passes. */
export type Cell = { status: string; matched: boolean | null; expected: string; regex: string };
export type GridCell = { label: string; title: string; status: string };

/** What text expects of the regex with id: "match", "no-match" or "none". */
function expected(text: Readonly<Text>, regexId: string): string {
	return text.expect[regexId] ?? "none";
}

/** none → match → no-match → none. */
function cycled(outcome: string): Outcome {
	if (outcome === "none") return "match";
	if (outcome === "match") return "no-match";
	return "none";
}

/** A cell of the grid. */
function cellOf(text: Readonly<Text>, regex: Readonly<Regex>): Cell {
	const wanted = expected(text, regex.id);
	const m = test(regex.pattern, regex.flags, text.text);
	if (m === null) return { status: "invalid", matched: null, expected: wanted, regex: regex.id };
	const status = wanted === "none" ? "none" : (wanted === "match") === m ? "pass" : "fail";
	return { status, matched: m, expected: wanted, regex: regex.id };
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

/** text, cut at n characters. */
function clip(text: string, n: number): string {
	return text.length <= n ? text : `${text.slice(0, n)}…`;
}

const CELL = "badge badge-ghost";

export type RegexLab = {
	/** The regexes, each with an id the model names it by (r1, r2, …). */
	regexes: Regex[];
	/** The texts, each saying per regex id whether it should match ("match" or "no-match"). */
	texts: Text[];
	/** The regex the texts highlight; "" for the first. */
	focus: string;
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	readonly focusLabel: string;
	/** The regexes as rows, with why each doesn't compile ("" when it does). */
	readonly regexRows: { id: string; pattern: string; flags: string; error: string }[];
	/** Each text cut into pieces, the focused regex's matches hit. */
	readonly highlights: { id: string; segments: { text: string; hit: boolean }[] }[];
	/** Every text × regex: whether the regex matches, what is expected and whether that passes. */
	readonly grid: { text: string; cells: Cell[] }[];
	/** The grid laid out as one list for a CSS grid: a header row of regex ids, then per text its
	 * id and a cell per regex. */
	readonly gridCells: GridCell[];
	readonly gridStyle: string;
	/** The counts of the grid's statuses. */
	readonly counts: { pass: number; fail: number; none: number; invalid: number };
};

export const RegexLab = {
	implements: ["MicroAgent"],
	meta: {
		// The grid cells' classes, which their loop's enrich computes.
		"https://tutuca.dev/meta/classes": {
			classes: "badge badge-success badge-error badge-warning badge-ghost font-mono text-xs opacity-70 text-left",
		},
	},
	defaults: { focus: "" },
	constraints: { regexes: { minLength: 1 }, texts: { minLength: 1 } },
	queries: {
		get counts() {
			let pass = 0;
			let fail = 0;
			let none = 0;
			let invalid = 0;
			for (const text of this.texts) {
				for (const regex of this.regexes) {
					const st = cellOf(text, regex).status;
					if (st === "pass") pass += 1;
					if (st === "fail") fail += 1;
					if (st === "none") none += 1;
					if (st === "invalid") invalid += 1;
				}
			}
			return { pass, fail, none, invalid };
		},
		get grid() {
			return this.texts.map((text) => ({ text: text.id, cells: this.regexes.map((regex) => cellOf(text, regex)) }));
		},
		get gridCells(): GridCell[] {
			const out: GridCell[] = [{ label: "t", title: "", status: "label" }];
			for (const regex of this.regexes) out.push({ label: regex.id, title: "", status: "label" });
			for (const text of this.texts) {
				out.push({ label: text.id, title: "", status: "label" });
				for (const regex of this.regexes) {
					const cell = cellOf(text, regex);
					const label = cell.matched === null ? "error" : cell.matched ? "matches" : "no match";
					out.push({ label, title: `expected: ${cell.expected}; click to change`, status: cell.status });
				}
			}
			return out;
		},
		get gridStyle(): string {
			return `grid-template-columns: max-content repeat(${this.regexes.length}, max-content)`;
		},
		get regexRows() {
			return this.regexes.map((r) => ({ id: r.id, pattern: r.pattern, flags: r.flags, error: error(r.pattern, r.flags) }));
		},
		get highlights() {
			const at = this.regexes.findIndex((r) => r.id === this.focus);
			const regex = this.regexes[at < 0 ? 0 : at] ?? { id: "", pattern: "", flags: "" };
			return this.texts.map((t) => ({ id: t.id, segments: segments(regex.pattern, regex.flags, t.text) }));
		},
		get focusLabel(): string {
			const at = this.regexes.findIndex((r) => r.id === this.focus);
			const regex = this.regexes[at < 0 ? 0 : at] ?? { id: "", pattern: "", flags: "" };
			return `/${regex.pattern}/${regex.flags}`;
		},
		get headline(): string {
			const c = this.counts;
			const out = `${c.pass} pass · ${c.fail} fail · ${c.none} unset`;
			return c.invalid > 0 ? `${out} · ${c.invalid} invalid` : out;
		},
		get summary(): string {
			const c = this.counts;
			const lines = [
				`${this.regexes.length} regexes, ${this.texts.length} texts: ${c.pass} expectations pass, ${c.fail} fail, ${c.none} cells have no expectation, ${c.invalid} invalid.`,
				"regexes:",
			];
			for (const r of this.regexes) {
				const why = error(r.pattern, r.flags);
				lines.push(`  ${r.id}: /${r.pattern}/${r.flags}${why === "" ? "" : ` (error: ${why})`}`);
			}
			lines.push("texts:");
			for (const t of this.texts) lines.push(`  ${t.id}: ${toJson(clip(t.text, 80), 0)} expects ${toJson(t.expect, 0)}`);
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { regexes, texts }. */
		get data(): unknown {
			return { regexes: this.regexes, texts: this.texts };
		},
		get domain(): unknown {
			return { regexes: this.regexes, texts: this.texts };
		},
		/** Where a regex matches a text: each match's position, text and capture groups. */
		explainMatches(regex: string, text: string): unknown {
			const r = this.regexes.find((x) => x.id === regex);
			if (r === undefined) return { error: `no regex ${regex}` };
			const t = this.texts.find((x) => x.id === text);
			if (t === undefined) return { error: `no text ${text}` };
			const why = error(r.pattern, r.flags);
			if (why !== "") return { error: why };
			const none: unknown[] = [];
			return { matches: matches(r.pattern, r.flags, t.text, 500) ?? none };
		},
	},
	on: {
		/** Change a regex's pattern and flags. */
		setRegex: {
			pure: true,
			changes: ["regexes"],
			pre(prev, [id, pattern, flags]: [string, string, string]) {
				return this.regexes.some((r) => r.id === id);
			},
			run(next, [id, pattern, flags]: [string, string, string]) {
				const i = this.regexes.findIndex((r) => r.id === id);
				if (i >= 0) next.regexes[i] = { id, pattern, flags };
			},
		},
		/** Add a regex; it gets the next free id (r1, r2, …). */
		addRegex: {
			pure: true,
			changes: ["regexes"],
			post(prev, next, [pattern, flags]: [string, string]) {
				return next.regexes.length === prev.regexes.length + 1;
			},
			run(next, [pattern, flags]: [string, string]) {
				next.regexes.push({ id: nextId(this.regexes.map((r) => r.id), "r"), pattern, flags });
			},
		},
		/** Remove a regex and the expectations that name it. pre is only checked in dev mode: the
		 * last regex stays. */
		removeRegex: {
			pure: true,
			changes: ["regexes", "texts", "focus"],
			pre(prev, [id]: [string]) {
				return this.regexes.some((r) => r.id === id) && this.regexes.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.regexes.length === prev.regexes.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.regexes.findIndex((r) => r.id === id);
				if (i < 0 || this.regexes.length <= 1) return;
				next.regexes.splice(i, 1);
				next.texts = this.texts.map((t) => ({ id: t.id, text: t.text, expect: without(t.expect, id) }));
				if (this.focus === id) next.focus = "";
			},
		},
		/** Move a regex to a position (0 is first). */
		reorderRegexes: {
			pure: true,
			changes: ["regexes"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.regexes.some((r) => r.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.regexes.length === prev.regexes.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.regexes.findIndex((r) => r.id === id);
				if (i < 0) return;
				const order = movedOrder(this.regexes.length, i, index);
				next.regexes = order.map((j) => this.regexes[j] ?? { id: "", pattern: "", flags: "" });
			},
		},
		/** Add a text to test against; it gets the next free id (t1, t2, …). */
		addText: {
			pure: true,
			changes: ["texts"],
			post(prev, next, [text]: [string]) {
				return next.texts.length === prev.texts.length + 1;
			},
			run(next, [text]: [string]) {
				next.texts.push({ id: nextId(this.texts.map((t) => t.id), "t"), text, expect: {} });
			},
		},
		/** Change a text. */
		setText: {
			pure: true,
			changes: ["texts"],
			pre(prev, [id, text]: [string, string]) {
				return this.texts.some((t) => t.id === id);
			},
			run(next, [id, text]: [string, string]) {
				const i = this.texts.findIndex((t) => t.id === id);
				const old = this.texts[i];
				if (old !== undefined) next.texts[i] = { id, text, expect: old.expect };
			},
		},
		/** Remove a text. pre is only checked in dev mode: the last text stays. */
		removeText: {
			pure: true,
			changes: ["texts"],
			pre(prev, [id]: [string]) {
				return this.texts.some((t) => t.id === id) && this.texts.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.texts.length === prev.texts.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.texts.findIndex((t) => t.id === id);
				if (i >= 0 && this.texts.length > 1) next.texts.splice(i, 1);
			},
		},
		/** Move a text to a position (0 is first). */
		reorderTexts: {
			pure: true,
			changes: ["texts"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.texts.some((t) => t.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.texts.length === prev.texts.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.texts.findIndex((t) => t.id === id);
				if (i < 0) return;
				const order = movedOrder(this.texts.length, i, index);
				next.texts = order.map((j) => this.texts[j] ?? { id: "", text: "", expect: {} });
			},
		},
		/** Say whether a regex should match a text: match, no-match, or none to clear it. */
		setExpectation: {
			pure: true,
			changes: ["texts"],
			pre(prev, [text, regex, outcome]: [string, string, Outcome]) {
				return this.texts.some((t) => t.id === text) && this.regexes.some((r) => r.id === regex);
			},
			run(next, [text, regex, outcome]: [string, string, Outcome]) {
				const i = this.texts.findIndex((t) => t.id === text);
				const t = this.texts[i];
				if (t === undefined) return;
				next.texts[i] = { id: t.id, text: t.text, expect: without(t.expect, regex) };
				const changed = next.texts[i];
				if (changed !== undefined && outcome !== "none") changed.expect[regex] = outcome;
			},
		},
		/** From the grid: cycles the expectation of the cell at index i (none → match → no-match
		 * → none). The header row has a corner and a cell per regex, then each text's row its
		 * label and a cell per regex. */
		cycleCell: {
			pure: true,
			changes: ["texts"],
			constraints: { i: { int: true, min: 0 } },
			run(next, [i]: [number]) {
				const width = this.regexes.length + 1;
				const row = Math.floor(i / width) - 1;
				const col = (i % width) - 1;
				const t = this.texts[row];
				const r = this.regexes[col];
				if (t === undefined || r === undefined) return;
				const outcome = cycled(expected(t, r.id));
				next.texts[row] = { id: t.id, text: t.text, expect: without(t.expect, r.id) };
				const changed = next.texts[row];
				if (changed !== undefined && outcome !== "none") changed.expect[r.id] = outcome;
			},
		},
		/** Which regex the texts highlight. */
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
		// The rows' own, by the row's key.
		focusAt: {
			pure: true,
			changes: ["focus"],
			constraints: { at: { keyOf: "regexes" } },
			run(next, [at]: [number | null]) {
				const r = at === null ? undefined : this.regexes[at];
				if (r !== undefined) next.focus = r.id;
			},
		},
		setPatternAt: {
			pure: true,
			changes: ["regexes"],
			constraints: { at: { keyOf: "regexes" } },
			run(next, [at, pattern]: [number | null, string]) {
				const r = at === null ? undefined : this.regexes[at];
				if (at !== null && r !== undefined) next.regexes[at] = { id: r.id, pattern, flags: r.flags };
			},
		},
		setFlagsAt: {
			pure: true,
			changes: ["regexes"],
			constraints: { at: { keyOf: "regexes" } },
			run(next, [at, flags]: [number | null, string]) {
				const r = at === null ? undefined : this.regexes[at];
				if (at !== null && r !== undefined) next.regexes[at] = { id: r.id, pattern: r.pattern, flags };
			},
		},
		removeRegexAt: {
			pure: true,
			changes: ["regexes", "texts", "focus"],
			constraints: { at: { keyOf: "regexes" } },
			run(next, [at]: [number | null]) {
				const r = at === null ? undefined : this.regexes[at];
				if (at === null || r === undefined || this.regexes.length <= 1) return;
				next.regexes.splice(at, 1);
				next.texts = this.texts.map((t) => ({ id: t.id, text: t.text, expect: without(t.expect, r.id) }));
				if (this.focus === r.id) next.focus = "";
			},
		},
		setTextAt: {
			pure: true,
			changes: ["texts"],
			constraints: { at: { keyOf: "texts" } },
			run(next, [at, text]: [number | null, string]) {
				const t = at === null ? undefined : this.texts[at];
				if (at !== null && t !== undefined) next.texts[at] = { id: t.id, text, expect: t.expect };
			},
		},
		removeTextAt: {
			pure: true,
			changes: ["texts"],
			constraints: { at: { keyOf: "texts" } },
			run(next, [at]: [number | null]) {
				if (at !== null && this.texts[at] !== undefined && this.texts.length > 1) next.texts.splice(at, 1);
			},
		},
	},
	loops: {
		gridCells: {
			enrich(key: number, cell: GridCell) {
				const cls =
					cell.status === "pass"
						? "badge badge-success"
						: cell.status === "fail"
							? "badge badge-error"
							: cell.status === "invalid"
								? "badge badge-warning"
								: cell.status === "label"
									? "font-mono text-xs opacity-70 text-left"
									: CELL;
				return { cellClass: cls };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "Regex lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Patterns"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("regexRows"),
				div(
					{ class: "flex flex-col gap-1" },
					div(
						{ class: "join w-full" },
						button(
							{ class: "btn btn-sm join-item font-mono", title: "Highlight this pattern", "on:click": send("focusAt", sourceKey()) },
							field("id"),
						),
						span({ class: "join-item flex items-center bg-base-200 px-2 font-mono" }, "/"),
						input({
							class: "input input-sm input-bordered join-item flex-1 font-mono",
							"aria-label": "Pattern",
							value: field("pattern"),
							"on:input": send("setPatternAt", sourceKey(), targetValue()),
						}),
						span({ class: "join-item flex items-center bg-base-200 px-2 font-mono" }, "/"),
						input({
							class: "input input-sm input-bordered join-item w-20 font-mono",
							"aria-label": "Flags",
							value: field("flags"),
							"on:input": send("setFlagsAt", sourceKey(), targetValue()),
						}),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeRegexAt", sourceKey()) },
							"✕",
						),
					),
					when(field("error"), p({ class: "text-xs text-error" }, field("error"))),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addRegex", "", "") }, "+ Pattern"),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Texts"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("texts"),
				div(
					{ class: "flex items-start gap-1" },
					span({ class: "font-mono text-xs opacity-60 pt-2" }, field("id")),
					textarea({
						class: "textarea textarea-bordered w-full font-mono text-sm",
						rows: "2",
						"aria-label": "Text",
						value: field("text"),
						"on:input": send("setTextAt", sourceKey(), targetValue()),
					}),
					button(
						{ class: "btn btn-sm btn-ghost", title: "Remove", "aria-label": "Remove", "on:click": send("removeTextAt", sourceKey()) },
						"✕",
					),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addText", "") }, "+ Text"),
		),
		h3(
			{ class: "text-xs font-semibold uppercase tracking-wide opacity-60" },
			"Matches of ",
			span({ class: "font-mono normal-case" }, field("focusLabel")),
		),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("highlights"),
				div(
					{ class: "flex gap-2 rounded-box border border-base-300 p-2" },
					span({ class: "font-mono text-xs opacity-60" }, field("id")),
					p(
						{ class: "whitespace-pre-wrap break-all font-mono text-sm" },
						each(
							field("segments"),
							span({ class: when(field("hit"), "rounded bg-warning/40 outline outline-1 outline-warning", "") }, field("text")),
						),
					),
				),
			),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Expectations"),
		p({ class: "text-xs opacity-60" }, "Click a cell to cycle its expectation: none → match → no match."),
		div(
			{ class: "grid gap-1 overflow-x-auto", style: field("gridStyle") },
			each(
				field("gridCells"),
				button({ class: lookupBind("cellClass"), title: field("title"), "on:click": send("cycleCell", sourceKey()) }, field("label")),
				"gridCells",
			),
		),
	),
};

export const register = { RegexLab: "RegexLab" };
