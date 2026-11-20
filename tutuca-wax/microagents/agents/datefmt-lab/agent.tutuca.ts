// datefmt-lab: instants (ISO times) formatted by strftime patterns and by Intl.DateTimeFormat
// settings, in a table of instant × format. A format may say, per instant id, which output it
// expects. strftime runs in UTC; Intl formats in UTC unless the options name a timeZone, and with
// "en-US" when the locale is empty, so the output never depends on the machine. The formatting is
// the page's (microagents/datefmt, microagents/engines/datefmt.js). The formats are the strftime
// ones, then the Intl ones: format k is strftimes[k] when k < strftimes.length, else
// intls[k - strftimes.length]. The root's messages are the agent's tools; the rows' inputs, the
// selects and the table send messages of their own, by the row's key or the cell's index.
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
	input,
	lookupBind,
	p,
	select,
	send,
	sourceKey,
	span,
	targetValue,
	when,
} from "tutuca/view";
import { range, toJson, without } from "tutuca/data";
import { directives, intl, intlInfo, isoOf, optionRows, parts, strftime, strftimeErrors } from "microagents/datefmt";

/** An instant: an ISO time (UTC when it has no offset), with the id the model names it by. */
export type Instant = { id: string; iso: string };
/** A strftime format: its pattern and the output it expects per instant id. */
export type Strftime = { id: string; format: string; expect: { [key: string]: string } };
/** An Intl format: its locale, its Intl.DateTimeFormat options (as strings) and the output it
 * expects per instant id. */
export type IntlFormat = { id: string; locale: string; options: { [key: string]: string }; expect: { [key: string]: string } };
/** A cell of the table: the output, the expected output (null for none), pass, fail, none or
 * error, and why it can't format ("" when it can). */
export type Cell = { output: string; expected: string | null; status: string; error: string };
export type GridCell = { label: string; title: string; status: string };
export type IntlCell = {
	kind: string;
	id: string;
	name: string;
	value: string;
	choices: { value: string; label: string }[];
	error: string;
	resolved: { text: string }[];
};
export type IntlOption =
	| "dateStyle"
	| "timeStyle"
	| "weekday"
	| "era"
	| "year"
	| "month"
	| "day"
	| "hour"
	| "minute"
	| "second"
	| "hour12"
	| "timeZone"
	| "timeZoneName";

/** Why raw isn't an ISO time. */
function notIso(raw: string): string {
	return `${toJson(raw, 0)} isn't an ISO time`;
}

/** A cell, from what formatting gave and what's expected. */
function cellFrom(output: string, error: string, expected: string | undefined): Cell {
	const want = expected ?? null;
	if (error !== "") return { output, expected: want, status: "error", error };
	if (expected === undefined) return { output, expected: want, status: "none", error };
	return { output, expected: want, status: expected === output ? "pass" : "fail", error };
}

/** A strftime format's cell for an instant. */
function strftimeCell(f: Readonly<Strftime>, instant: Readonly<Instant>): Cell {
	const iso = isoOf(instant.iso);
	const got = iso === null ? null : strftime(f.format, iso);
	if (got === null) return cellFrom("", notIso(instant.iso), f.expect[instant.id]);
	return cellFrom(got.text, got.error, f.expect[instant.id]);
}

/** An Intl format's cell for an instant. */
function intlCell(f: Readonly<IntlFormat>, instant: Readonly<Instant>): Cell {
	const iso = isoOf(instant.iso);
	const got = iso === null ? null : intl(f.locale, f.options, iso);
	if (got === null) return cellFrom("", notIso(instant.iso), f.expect[instant.id]);
	return cellFrom(got.text, got.error, f.expect[instant.id]);
}

/** An instant's row of the table: a cell per strftime format, then per Intl format. */
function rowOf(strftimes: readonly Strftime[], intls: readonly IntlFormat[], instant: Readonly<Instant>): Cell[] {
	const out: Cell[] = [];
	for (const f of strftimes) out.push(strftimeCell(f, instant));
	for (const f of intls) out.push(intlCell(f, instant));
	return out;
}

/** The formats' ids, strftime ones then Intl ones. */
function formatIds(strftimes: readonly Strftime[], intls: readonly IntlFormat[]): string[] {
	const out: string[] = [];
	for (const f of strftimes) out.push(f.id);
	for (const f of intls) out.push(f.id);
	return out;
}

/** The instant's ISO time, or what it holds when it isn't one. */
function instantIso(instant: Readonly<Instant>): string {
	return isoOf(instant.iso) ?? instant.iso;
}

/** " expects {…}" when expect has expectations, else "". */
function expectsText(expect: Readonly<{ [key: string]: string }>): string {
	return Object.keys(expect).length === 0 ? "" : ` expects ${toJson(expect, 0)}`;
}

/** Whether an Intl option takes value ("" removes it; timeZone takes any name). */
function optionAllows(option: string, value: string): boolean {
	if (value === "" || option === "timeZone") return true;
	if (option === "dateStyle" || option === "timeStyle") return ["full", "long", "medium", "short"].includes(value);
	if (option === "weekday" || option === "era") return ["long", "short", "narrow"].includes(value);
	if (option === "month") return ["numeric", "2-digit", "long", "short", "narrow"].includes(value);
	if (option === "hour12") return ["true", "false"].includes(value);
	if (option === "timeZoneName") return ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"].includes(value);
	return ["numeric", "2-digit"].includes(value);
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

/** How many of intlCells each Intl format has: its head and a cell per option. */
function intlWidth(): number {
	const none: { [key: string]: string } = {};
	return optionRows(none).length + 1;
}

export type DatefmtLab = {
	/** The instants, each an ISO time (UTC when it has no offset) with an id the model names it by
	 * (i1, i2, …). */
	instants: Instant[];
	/** The strftime formats, each with its pattern and the output it expects per instant id. */
	strftimes: Strftime[];
	/** The Intl formats, each with its locale, its Intl.DateTimeFormat options (as strings) and the
	 * output it expects per instant id. */
	intls: IntlFormat[];
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	/** The instants as rows, with why each isn't an ISO time ("" when it is). */
	readonly instantRows: { id: string; iso: string; error: string }[];
	/** The strftime formats as rows, with why each pattern has errors ("" when it has none). */
	readonly strftimeRows: { id: string; format: string; error: string }[];
	/** The Intl formats laid out as one list: per format a head (locale, error, resolved options),
	 * then a cell per option. */
	readonly intlCells: IntlCell[];
	/** Every instant × format: the output, the expected output and whether it passes. */
	readonly formatted: unknown;
	/** The table laid out as one list for a CSS grid: a header row of format ids, then per instant
	 * its time and a cell per format. */
	readonly gridCells: GridCell[];
	readonly gridStyle: string;
	/** The parts of the first valid instant per Intl format. */
	readonly partRows: { id: string; parts: { text: string; label: string }[] }[];
	/** The strftime directives this lab supports. */
	readonly directives: unknown;
	/** Every cell's row by instant, strftime formats then Intl ones. */
	readonly cells: Cell[][];
	/** The counts of the table's statuses. */
	readonly counts: { pass: number; fail: number; none: number; error: number };
};

export const DatefmtLab = {
	implements: ["MicroAgent"],
	meta: {
		// The table's and the Intl cells' classes, which their loops' enrich computes.
		"https://tutuca.dev/meta/classes": {
			classes:
				"badge badge-success badge-error badge-warning badge-ghost h-auto whitespace-pre-wrap font-mono text-xs opacity-70 text-left",
		},
	},
	defaults: { strftimes: [], intls: [] },
	constraints: { instants: { minLength: 1 } },
	queries: {
		get cells(): Cell[][] {
			return this.instants.map((instant) => rowOf(this.strftimes, this.intls, instant));
		},
		get counts() {
			let pass = 0;
			let fail = 0;
			let none = 0;
			let error = 0;
			for (const row of this.cells) {
				for (const cell of row) {
					if (cell.status === "pass") pass += 1;
					if (cell.status === "fail") fail += 1;
					if (cell.status === "none") none += 1;
					if (cell.status === "error") error += 1;
				}
			}
			return { pass, fail, none, error };
		},
		get formatted(): unknown {
			const ids = formatIds(this.strftimes, this.intls);
			return this.instants.map((instant) => ({
				instant: instant.id,
				iso: instantIso(instant),
				cells: rowOf(this.strftimes, this.intls, instant).map((c, k) => ({
					format: ids[k] ?? "",
					output: c.output,
					expected: c.expected,
					status: c.status,
					error: c.error,
				})),
			}));
		},
		get gridCells(): GridCell[] {
			const out: GridCell[] = [{ label: "instant", title: "", status: "label" }];
			for (const f of this.strftimes) out.push({ label: f.id, title: "", status: "label" });
			for (const f of this.intls) out.push({ label: f.id, title: "", status: "label" });
			for (const instant of this.instants) {
				out.push({ label: instantIso(instant), title: instant.id, status: "label" });
				for (const cell of rowOf(this.strftimes, this.intls, instant)) {
					const wanted = cell.expected ?? "nothing";
					const title = cell.error === "" ? `expected: ${wanted}; click to pin or clear` : cell.error;
					out.push({ label: cell.output === "" ? "error" : cell.output, title, status: cell.status });
				}
			}
			return out;
		},
		get gridStyle(): string {
			return `grid-template-columns: max-content repeat(${this.strftimes.length + this.intls.length}, max-content)`;
		},
		get instantRows() {
			return this.instants.map((i) => ({ id: i.id, iso: i.iso, error: isoOf(i.iso) === null ? notIso(i.iso) : "" }));
		},
		get strftimeRows() {
			return this.strftimes.map((f) => ({ id: f.id, format: f.format, error: strftimeErrors(f.format) }));
		},
		get intlCells(): IntlCell[] {
			const out: IntlCell[] = [];
			for (const f of this.intls) {
				const info = intlInfo(f.locale, f.options);
				const noChoices: { value: string; label: string }[] = [];
				out.push({
					kind: "head",
					id: f.id,
					name: "",
					value: f.locale,
					choices: noChoices,
					error: info.error,
					resolved: info.resolved.map((text) => ({ text })),
				});
				for (const row of optionRows(f.options)) {
					const noResolved: { text: string }[] = [];
					out.push({ kind: "option", id: f.id, name: row.name, value: row.value, choices: row.choices, error: "", resolved: noResolved });
				}
			}
			return out;
		},
		get partRows() {
			let first = "";
			for (const instant of this.instants) {
				const iso = isoOf(instant.iso);
				if (iso !== null) {
					first = iso;
					break;
				}
			}
			const out: { id: string; parts: { text: string; label: string }[] }[] = [];
			if (first === "") return out;
			for (const f of this.intls) {
				out.push({ id: f.id, parts: parts(f.locale, f.options, first).map((x) => ({ text: x.value, label: x.type })) });
			}
			return out;
		},
		get directives(): unknown {
			return directives();
		},
		get headline(): string {
			const c = this.counts;
			return `${c.pass} pass · ${c.fail} fail · ${c.none} unset · ${c.error} error`;
		},
		get summary(): string {
			const c = this.counts;
			const lines = [
				`${this.instants.length} instants, ${this.strftimes.length} strftime formats, ${this.intls.length} Intl formats: ${c.pass} expectations pass, ${c.fail} fail, ${c.error} cells error.`,
				"instants:",
			];
			for (const i of this.instants) lines.push(`  ${i.id}: ${instantIso(i)}${isoOf(i.iso) === null ? " (invalid)" : ""}`);
			lines.push("formats:");
			for (const f of this.strftimes) lines.push(`  ${f.id}: strftime ${toJson(f.format, 0)}${expectsText(f.expect)}`);
			for (const f of this.intls) {
				lines.push(`  ${f.id}: Intl ${f.locale === "" ? "en-US" : f.locale} ${toJson(f.options, 0)}${expectsText(f.expect)}`);
			}
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { instants, strftimes, intls }. */
		get data(): unknown {
			return { instants: this.instants, strftimes: this.strftimes, intls: this.intls };
		},
		get domain(): unknown {
			return { instants: this.instants, strftimes: this.strftimes, intls: this.intls };
		},
		/** A strftime pattern applied to every instant, without saving it: [{ instant, text, error }]. */
		tryStrftime(format: string): unknown {
			return this.instants.map((i) => {
				const got = strftime(format, i.iso);
				return got === null ? { text: "", error: notIso(i.iso), instant: i.id } : { text: got.text, error: got.error, instant: i.id };
			});
		},
	},
	on: {
		/** Add an instant from an ISO time (UTC when it has no offset); it gets the next free id (i1,
		 * i2, …). */
		addInstant: {
			pure: true,
			changes: ["instants"],
			constraints: {
				iso: {
					pattern:
						"^[+-]?[0-9]{4,6}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,9})?)?)? *([Zz]|[+-][0-9]{2}:?[0-9]{2})?$",
				},
			},
			post(prev, next, [iso]: [string]) {
				return next.instants.length === prev.instants.length + 1;
			},
			run(next, [iso]: [string]) {
				next.instants.push({ id: nextId(this.instants.map((i) => i.id), "i"), iso });
			},
		},
		/** Change an instant to an ISO time. */
		setInstant: {
			pure: true,
			changes: ["instants"],
			pre(prev, [id, iso]: [string, string]) {
				return this.instants.some((i) => i.id === id);
			},
			run(next, [id, iso]: [string, string]) {
				const item = next.instants[this.instants.findIndex((i) => i.id === id)];
				if (item !== undefined) item.iso = iso;
			},
		},
		/** Remove an instant, and the expectations that name it. pre is only checked in dev mode: the
		 * last instant stays. */
		removeInstant: {
			pure: true,
			changes: ["instants", "strftimes", "intls"],
			pre(prev, [id]: [string]) {
				return this.instants.some((i) => i.id === id) && this.instants.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.instants.length === prev.instants.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.instants.findIndex((x) => x.id === id);
				if (i < 0 || this.instants.length <= 1) return;
				next.instants.splice(i, 1);
				next.strftimes = this.strftimes.map((f) => ({ id: f.id, format: f.format, expect: without(f.expect, id) }));
				next.intls = this.intls.map((f) => ({ id: f.id, locale: f.locale, options: f.options, expect: without(f.expect, id) }));
			},
		},
		/** Move an instant to a position (0 is first): the order of the table's rows. */
		reorderInstants: {
			pure: true,
			changes: ["instants"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.instants.some((i) => i.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.instants.length === prev.instants.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.instants.findIndex((x) => x.id === id);
				if (i < 0) return;
				const order = movedOrder(this.instants.length, i, index);
				next.instants = order.map((j) => this.instants[j] ?? { id: "", iso: "" });
			},
		},
		/** Add a strftime format; it gets the next free id (f1, f2, …, shared with the Intl formats). */
		addStrftime: {
			pure: true,
			changes: ["strftimes"],
			post(prev, next, [format]: [string]) {
				return next.strftimes.length === prev.strftimes.length + 1;
			},
			run(next, [format]: [string]) {
				const ids = formatIds(this.strftimes, this.intls);
				next.strftimes.push({ id: nextId(ids, "f"), format, expect: {} });
			},
		},
		/** Change a strftime format's pattern. */
		setStrftime: {
			pure: true,
			changes: ["strftimes"],
			pre(prev, [id, format]: [string, string]) {
				return this.strftimes.some((f) => f.id === id);
			},
			run(next, [id, format]: [string, string]) {
				const item = next.strftimes[this.strftimes.findIndex((f) => f.id === id)];
				if (item !== undefined) item.format = format;
			},
		},
		/** Move a strftime format to a position among the strftime formats (0 is first); they come
		 * before the Intl ones in the table's columns. */
		reorderStrftimes: {
			pure: true,
			changes: ["strftimes"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.strftimes.some((f) => f.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.strftimes.length === prev.strftimes.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.strftimes.findIndex((f) => f.id === id);
				if (i < 0) return;
				const order = movedOrder(this.strftimes.length, i, index);
				next.strftimes = order.map((j) => this.strftimes[j] ?? { id: "", format: "", expect: {} });
			},
		},
		/** Add an Intl format for a locale (dateStyle medium); it gets the next free id (f1, f2, …,
		 * shared with the strftime formats). */
		addIntl: {
			pure: true,
			changes: ["intls"],
			post(prev, next, [locale]: [string]) {
				return next.intls.length === prev.intls.length + 1;
			},
			run(next, [locale]: [string]) {
				const ids = formatIds(this.strftimes, this.intls);
				next.intls.push({ id: nextId(ids, "f"), locale, options: { dateStyle: "medium" }, expect: {} });
			},
		},
		/** Change an Intl format's locale (a BCP 47 tag such as en-US or de-DE). */
		setLocale: {
			pure: true,
			changes: ["intls"],
			pre(prev, [id, locale]: [string, string]) {
				return this.intls.some((f) => f.id === id);
			},
			run(next, [id, locale]: [string, string]) {
				const item = next.intls[this.intls.findIndex((f) => f.id === id)];
				if (item !== undefined) item.locale = locale;
			},
		},
		/** Set one option of an Intl format, or remove it with "". hour12 takes "true" or "false";
		 * timeZone any IANA name. */
		setIntlOption: {
			pure: true,
			changes: ["intls"],
			pre(prev, [id, option, value]: [string, IntlOption, string]) {
				return this.intls.some((f) => f.id === id) && optionAllows(option, value);
			},
			run(next, [id, option, value]: [string, IntlOption, string]) {
				const i = this.intls.findIndex((f) => f.id === id);
				const f = this.intls[i];
				if (f === undefined) return;
				if (value === "") {
					next.intls[i] = { id: f.id, locale: f.locale, options: without(f.options, option), expect: f.expect };
					return;
				}
				const key: string = option;
				const item = next.intls[i];
				if (item !== undefined) item.options[key] = value;
			},
		},
		/** Move an Intl format to a position among the Intl formats (0 is first). */
		reorderIntls: {
			pure: true,
			changes: ["intls"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.intls.some((f) => f.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.intls.length === prev.intls.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.intls.findIndex((f) => f.id === id);
				if (i < 0) return;
				const order = movedOrder(this.intls.length, i, index);
				next.intls = order.map((j) => this.intls[j] ?? { id: "", locale: "", options: {}, expect: {} });
			},
		},
		/** Remove a strftime or Intl format. pre is only checked in dev mode: the last format,
		 * strftime or Intl, stays. */
		removeFormat: {
			pure: true,
			changes: ["strftimes", "intls"],
			pre(prev, [id]: [string]) {
				const known = this.strftimes.some((f) => f.id === id) || this.intls.some((f) => f.id === id);
				return known && this.strftimes.length + this.intls.length > 1;
			},
			run(next, [id]: [string]) {
				if (this.strftimes.length + this.intls.length <= 1) return;
				const s = this.strftimes.findIndex((f) => f.id === id);
				if (s >= 0) {
					next.strftimes.splice(s, 1);
					return;
				}
				const i = this.intls.findIndex((f) => f.id === id);
				if (i >= 0) next.intls.splice(i, 1);
			},
		},
		/** Set the output a format should give for an instant, or "" to clear it. */
		setExpectation: {
			pure: true,
			changes: ["strftimes", "intls"],
			pre(prev, [format, instant, expected]: [string, string, string]) {
				const known = this.strftimes.some((f) => f.id === format) || this.intls.some((f) => f.id === format);
				return known && this.instants.some((i) => i.id === instant);
			},
			run(next, [format, instant, expected]: [string, string, string]) {
				const s = this.strftimes.findIndex((f) => f.id === format);
				const sf = this.strftimes[s];
				if (sf !== undefined) {
					next.strftimes[s] = { id: sf.id, format: sf.format, expect: without(sf.expect, instant) };
					const changed = next.strftimes[s];
					if (changed !== undefined && expected !== "") changed.expect[instant] = expected;
					return;
				}
				const i = this.intls.findIndex((f) => f.id === format);
				const nf = this.intls[i];
				if (nf === undefined) return;
				next.intls[i] = { id: nf.id, locale: nf.locale, options: nf.options, expect: without(nf.expect, instant) };
				const changed = next.intls[i];
				if (changed !== undefined && expected !== "") changed.expect[instant] = expected;
			},
		},
		/** From the table: the cell at index i pins its output as expected, or clears it. The header
		 * row has a corner and a cell per format, then each instant's row its label and a cell per
		 * format. */
		pinCell: {
			pure: true,
			changes: ["strftimes", "intls"],
			constraints: { i: { int: true, min: 0 } },
			run(next, [i]: [number]) {
				const width = this.strftimes.length + this.intls.length + 1;
				const row = Math.floor(i / width) - 1;
				const col = (i % width) - 1;
				const instant = this.instants[row];
				if (instant === undefined || col < 0) return;
				const iid = instant.id;
				const sf = this.strftimes[col];
				if (sf !== undefined) {
					const pinned = sf.expect[iid] !== undefined;
					const cell = strftimeCell(sf, instant);
					if (!pinned && (cell.status === "error" || cell.output === "")) return;
					next.strftimes[col] = { id: sf.id, format: sf.format, expect: without(sf.expect, iid) };
					const changed = next.strftimes[col];
					if (changed !== undefined && !pinned) changed.expect[iid] = cell.output;
					return;
				}
				const k = col - this.strftimes.length;
				const nf = this.intls[k];
				if (nf === undefined) return;
				const pinned = nf.expect[iid] !== undefined;
				const cell = intlCell(nf, instant);
				if (!pinned && (cell.status === "error" || cell.output === "")) return;
				next.intls[k] = { id: nf.id, locale: nf.locale, options: nf.options, expect: without(nf.expect, iid) };
				const changed = next.intls[k];
				if (changed !== undefined && !pinned) changed.expect[iid] = cell.output;
			},
		},
		// The rows' own, by the row's key (or the Intl cell's index).
		setInstantAt: {
			pure: true,
			changes: ["instants"],
			constraints: { at: { keyOf: "instants" } },
			run(next, [at, iso]: [number | null, string]) {
				if (at === null) return;
				const item = next.instants[at];
				if (item !== undefined) item.iso = iso;
			},
		},
		removeInstantAt: {
			pure: true,
			changes: ["instants", "strftimes", "intls"],
			constraints: { at: { keyOf: "instants" } },
			run(next, [at]: [number | null]) {
				const instant = at === null ? undefined : this.instants[at];
				if (at === null || instant === undefined || this.instants.length <= 1) return;
				next.instants.splice(at, 1);
				next.strftimes = this.strftimes.map((f) => ({ id: f.id, format: f.format, expect: without(f.expect, instant.id) }));
				next.intls = this.intls.map((f) => ({ id: f.id, locale: f.locale, options: f.options, expect: without(f.expect, instant.id) }));
			},
		},
		setStrftimeAt: {
			pure: true,
			changes: ["strftimes"],
			constraints: { at: { keyOf: "strftimes" } },
			run(next, [at, format]: [number | null, string]) {
				if (at === null) return;
				const item = next.strftimes[at];
				if (item !== undefined) item.format = format;
			},
		},
		removeStrftimeAt: {
			pure: true,
			changes: ["strftimes"],
			constraints: { at: { keyOf: "strftimes" } },
			run(next, [at]: [number | null]) {
				if (at === null || this.strftimes[at] === undefined || this.strftimes.length + this.intls.length <= 1) return;
				next.strftimes.splice(at, 1);
			},
		},
		/** From an Intl cell at index at (a head): its format's locale. */
		setLocaleAt: {
			pure: true,
			changes: ["intls"],
			constraints: { at: { int: true, min: 0 } },
			run(next, [at, locale]: [number, string]) {
				const item = next.intls[Math.floor(at / intlWidth())];
				if (item !== undefined) item.locale = locale;
			},
		},
		/** From an Intl cell at index at (a head): removes its format. */
		removeIntlAt: {
			pure: true,
			changes: ["intls"],
			constraints: { at: { int: true, min: 0 } },
			run(next, [at]: [number]) {
				const k = Math.floor(at / intlWidth());
				if (this.intls[k] === undefined || this.strftimes.length + this.intls.length <= 1) return;
				next.intls.splice(k, 1);
			},
		},
		/** From an Intl cell at index at (an option): sets that option of its format, or removes it
		 * with "". */
		setIntlOptionAt: {
			pure: true,
			changes: ["intls"],
			constraints: { at: { int: true, min: 0 } },
			run(next, [at, value]: [number, string]) {
				const width = intlWidth();
				const k = Math.floor(at / width);
				const f = this.intls[k];
				if (f === undefined) return;
				const row = optionRows(f.options)[(at % width) - 1];
				if (row === undefined) return;
				if (value === "") {
					next.intls[k] = { id: f.id, locale: f.locale, options: without(f.options, row.name), expect: f.expect };
					return;
				}
				const item = next.intls[k];
				if (item !== undefined) item.options[row.name] = value;
			},
		},
	},
	loops: {
		intlCells: {
			enrich(key: number, cell: IntlCell) {
				return { isHead: cell.kind === "head" };
			},
		},
		gridCells: {
			enrich(key: number, cell: GridCell) {
				const cls =
					cell.status === "pass"
						? "badge badge-success h-auto whitespace-pre-wrap font-mono"
						: cell.status === "fail"
							? "badge badge-error h-auto whitespace-pre-wrap font-mono"
							: cell.status === "error"
								? "badge badge-warning h-auto whitespace-pre-wrap font-mono"
								: cell.status === "label"
									? "font-mono text-xs opacity-70 text-left"
									: "badge badge-ghost h-auto whitespace-pre-wrap font-mono";
				return { cellClass: cls };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "Date format lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Instants"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("instantRows"),
				div(
					{ class: "flex flex-col gap-1" },
					div(
						{ class: "join w-full" },
						span({ class: "join-item flex items-center bg-base-200 px-2 font-mono text-sm" }, field("id")),
						input({
							class: "input input-sm input-bordered join-item flex-1 font-mono",
							"aria-label": "Instant",
							value: field("iso"),
							"on:input": send("setInstantAt", sourceKey(), targetValue()),
						}),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeInstantAt", sourceKey()) },
							"✕",
						),
					),
					when(field("error"), p({ class: "text-xs text-error" }, field("error"))),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addInstant", "2024-01-01T00:00:00Z") }, "+ Instant"),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Formats"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("strftimeRows"),
				div(
					{ class: "flex flex-col gap-1" },
					div(
						{ class: "join w-full" },
						span({ class: "join-item flex items-center bg-base-200 px-2 font-mono text-sm" }, field("id")),
						span({ class: "join-item flex items-center bg-base-200 px-2 text-xs" }, "strftime"),
						input({
							class: "input input-sm input-bordered join-item flex-1 font-mono",
							"aria-label": "strftime format",
							value: field("format"),
							"on:input": send("setStrftimeAt", sourceKey(), targetValue()),
						}),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeStrftimeAt", sourceKey()) },
							"✕",
						),
					),
					when(field("error"), p({ class: "text-xs text-error" }, field("error"))),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addStrftime", "%Y-%m-%d %H:%M:%S") }, "+ strftime"),
		),
		div(
			{ class: "flex flex-wrap items-end gap-2" },
			each(
				field("intlCells"),
				when(
					lookupBind("isHead"),
					div(
						{ class: "flex w-full flex-col gap-1 pt-2" },
						div(
							{ class: "join w-full" },
							span({ class: "join-item flex items-center bg-base-200 px-2 font-mono text-sm" }, field("id")),
							span({ class: "join-item flex items-center bg-base-200 px-2 text-xs" }, "Intl locale"),
							input({
								class: "input input-sm input-bordered join-item flex-1 font-mono",
								"aria-label": "Locale",
								value: field("value"),
								"on:input": send("setLocaleAt", sourceKey(), targetValue()),
							}),
							button(
								{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeIntlAt", sourceKey()) },
								"✕",
							),
						),
						when(field("error"), p({ class: "text-xs text-error" }, field("error"))),
						div(
							{ class: "flex flex-wrap gap-1" },
							each(field("resolved"), span({ class: "badge badge-ghost badge-sm font-mono" }, field("text"))),
						),
					),
					div(
						{ class: "flex flex-col text-xs" },
						span({ class: "opacity-60" }, field("name")),
						select(
							{
								class: "select select-xs select-bordered",
								"aria-label": field("name"),
								value: field("value"),
								"on:change": send("setIntlOptionAt", sourceKey(), targetValue()),
							},
							each(field("choices"), h("option", { value: field("value") }, field("label"))),
						),
					),
				),
				"intlCells",
			),
		),
		button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addIntl", "en-US") }, "+ Intl"),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Output"),
		p({ class: "text-xs opacity-60" }, "Click a cell to pin its output as expected, or to clear it."),
		div(
			{ class: "grid gap-1 overflow-x-auto", style: field("gridStyle") },
			each(
				field("gridCells"),
				button({ class: lookupBind("cellClass"), title: field("title"), "on:click": send("pinCell", sourceKey()) }, field("label")),
				"gridCells",
			),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Intl parts of the first instant"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("partRows"),
				div(
					{ class: "flex flex-wrap items-center gap-1" },
					span({ class: "font-mono text-xs opacity-60" }, field("id")),
					each(
						field("parts"),
						span(
							{ class: "badge badge-outline h-auto gap-1 font-mono", title: field("label") },
							field("text"),
							span({ class: "text-[10px] opacity-50" }, field("label")),
						),
					),
				),
			),
		),
	),
};

export const register = { DatefmtLab: "DatefmtLab" };
