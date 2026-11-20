// cron-lab: standard 5-field cron expressions (minute hour day month weekday, or a macro), each
// described in English and run forward from its reference time ("from") to show its next runs. A
// cron may say which first run it expects (expectNext). Runs are computed in UTC, so the same
// data always shows the same runs; the timezone only says how they read there. Parsing, the
// English and the runs are the page's (microagents/cron, microagents/engines/cron.js). The
// root's messages are the agent's tools; the rows' inputs and the builder's chips send messages
// of their own, by the row's key.
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
	li,
	lookupBind,
	p,
	send,
	sourceKey,
	span,
	targetValue,
	ul,
	when,
} from "tutuca/view";
import { range, toJson } from "tutuca/data";
import { chips, explain, isoOf, runs, toggle, withField } from "microagents/cron";

/** A cron expression, with the id the model names it by (c1, c2, …), a timezone label, the ISO
 * time its runs count from ("" for 2025-01-01T00:00:00Z) and the ISO time its first run should be
 * ("" for none). */
export type Cron = { id: string; expression: string; timezone: string; from: string; expectNext: string };
export type CronRow = {
	id: string;
	expression: string;
	timezone: string;
	from: string;
	expectNext: string;
	error: string;
	description: string;
	status: string;
	statusText: string;
	fromLabel: string;
	runs: { text: string }[];
};
export type Chip = { label: string; status: string; title: string };
export type ChipField = { name: string; low: number; count: number };

const DEFAULT_FROM = "2025-01-01T00:00:00Z";

/** The time c's runs count from, normalized: its from, or the default. */
function fromOf(c: Readonly<Cron>): string {
	const fallback = isoOf(DEFAULT_FROM) ?? DEFAULT_FROM;
	if (c.from === "") return fallback;
	return isoOf(c.from) ?? fallback;
}

/** The ISO time of c's first run, or "" when there's none. */
function firstOf(c: Readonly<Cron>): string {
	const got = runs(c.expression, c.timezone, fromOf(c), 1);
	if (got === null) return "";
	const first = got[0];
	return first === undefined ? "" : first.iso;
}

/** pass, fail or none: whether c's first run is the one it expects. */
function statusOf(c: Readonly<Cron>): string {
	if (c.expectNext === "") return "none";
	const first = firstOf(c);
	const want = isoOf(c.expectNext);
	if (want === null) return "fail";
	return first !== "" && first === want ? "pass" : "fail";
}

/** The ISO times of c's next n runs; none when it doesn't parse. */
function isosOf(c: Readonly<Cron>, n: number): string[] {
	const got = runs(c.expression, c.timezone, fromOf(c), n);
	const none: string[] = [];
	return got === null ? none : got.map((r) => r.iso);
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

/** The builder's fields, in order: name, lowest value, how many values. */
function chipField(k: number): ChipField {
	if (k === 0) return { name: "minute", low: 0, count: 60 };
	if (k === 1) return { name: "hour", low: 0, count: 24 };
	if (k === 2) return { name: "day", low: 1, count: 31 };
	if (k === 3) return { name: "month", low: 1, count: 12 };
	return { name: "weekday", low: 0, count: 7 };
}

export type CronLab = {
	/** The cron expressions, each with an id the model names it by (c1, c2, …), a timezone label,
	 * the ISO time its runs count from ("" for 2025-01-01T00:00:00Z) and the ISO time its first run
	 * should be ("" for none). */
	crons: Cron[];
	/** The cron the builder edits; "" for the first. */
	focus: string;
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	/** The crons as rows: why each doesn't parse, or its English and next 5 runs, and whether its
	 * expectation passes. */
	readonly cronRows: CronRow[];
	readonly focusLabel: string;
	/** The builder of the focused cron: per field a label, then a chip per value, the ones it
	 * picks on. */
	readonly chips: Chip[];
	/** How many crons don't parse, and how many expectations pass and fail. */
	readonly counts: { invalid: number; pass: number; fail: number };
};

export const CronLab = {
	implements: ["MicroAgent"],
	meta: {
		// The chips' classes, which their loop's enrich computes.
		"https://tutuca.dev/meta/classes": {
			classes: "btn btn-xs min-h-0 h-6 px-1 font-mono btn-primary btn-ghost opacity-60 basis-full pt-1 text-left",
		},
	},
	defaults: { focus: "" },
	constraints: { crons: { minLength: 1 } },
	queries: {
		get counts() {
			let invalid = 0;
			let pass = 0;
			let fail = 0;
			for (const c of this.crons) {
				if (explain(c.expression).error !== "") invalid += 1;
				const st = statusOf(c);
				if (st === "pass") pass += 1;
				if (st === "fail") fail += 1;
			}
			return { invalid, pass, fail };
		},
		get cronRows(): CronRow[] {
			const out: CronRow[] = [];
			for (const c of this.crons) {
				const explained = explain(c.expression);
				const lines: { text: string }[] = [];
				const got = runs(c.expression, c.timezone, fromOf(c), 5);
				if (got !== null) {
					for (const run of got) lines.push({ text: run.local === "" ? run.iso : `${run.iso} · ${run.local}` });
				}
				const fromLabel =
					c.timezone === "" || c.timezone === "UTC"
						? `next runs after ${fromOf(c)} (computed in UTC)`
						: `next runs after ${fromOf(c)} (computed in UTC, also shown in ${c.timezone})`;
				const status = statusOf(c);
				out.push({
					id: c.id,
					expression: c.expression,
					timezone: c.timezone,
					from: c.from,
					expectNext: c.expectNext,
					error: explained.error,
					description: explained.description,
					status,
					statusText: `${status}: expects ${c.expectNext}`,
					fromLabel,
					runs: lines,
				});
			}
			return out;
		},
		get focusLabel(): string {
			const at = this.crons.findIndex((c) => c.id === this.focus);
			const c = this.crons[at < 0 ? 0 : at] ?? { id: "", expression: "", timezone: "", from: "", expectNext: "" };
			return `${c.id}: ${c.expression}`;
		},
		get chips(): Chip[] {
			const at = this.crons.findIndex((c) => c.id === this.focus);
			const c = this.crons[at < 0 ? 0 : at] ?? { id: "", expression: "", timezone: "", from: "", expectNext: "" };
			return chips(c.expression);
		},
		get headline(): string {
			const n = this.counts;
			return `${this.crons.length} expressions · ${n.invalid} invalid · ${n.pass} pass · ${n.fail} fail`;
		},
		get summary(): string {
			const n = this.counts;
			const lines = [`${this.crons.length} cron expressions: ${n.invalid} invalid, ${n.pass} expectations pass, ${n.fail} fail.`];
			for (const c of this.crons) {
				const explained = explain(c.expression);
				let line = `  ${c.id}: ${toJson(c.expression, 0)} (${c.timezone}) `;
				if (explained.error === "") {
					const first = firstOf(c);
					line = `${line}"${explained.description}", next ${first === "" ? "never" : first}`;
				} else {
					line = `${line}error: ${explained.error}`;
				}
				if (c.from !== "") line = `${line}, from ${c.from}`;
				if (c.expectNext !== "") line = `${line}, expects next ${c.expectNext}: ${statusOf(c)}`;
				lines.push(line);
			}
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { crons }. */
		get data(): unknown {
			return { crons: this.crons };
		},
		get domain(): unknown {
			return { crons: this.crons };
		},
		/** An expression's English description, each field's text and values, and its next 5 runs. */
		explain(id: string): unknown {
			const c = this.crons.find((x) => x.id === id);
			if (c === undefined) return { error: `no cron ${id}` };
			const explained = explain(c.expression);
			if (explained.error !== "") return { id, expression: c.expression, error: explained.error, field: explained.field };
			return {
				id,
				expression: c.expression,
				timezone: c.timezone,
				description: explained.description,
				fields: explained.fields,
				from: fromOf(c),
				next: isosOf(c, 5),
				expectNext: c.expectNext === "" ? null : c.expectNext,
				status: statusOf(c),
			};
		},
		/** The next count runs of an expression (1 to 100), as UTC ISO times. */
		nextRuns(id: string, count: number): unknown {
			const c = this.crons.find((x) => x.id === id);
			if (c === undefined) return { error: `no cron ${id}` };
			if (!Number.isInteger(count) || count < 1 || count > 100) return { error: `count is ${count}: it must be a whole number from 1 to 100` };
			const why = explain(c.expression).error;
			if (why !== "") return { error: why };
			return { id, from: fromOf(c), runs: isosOf(c, count) };
		},
	},
	on: {
		/** Replace an expression (5 fields or a macro such as @daily). */
		setExpression: {
			pure: true,
			changes: ["crons"],
			pre(prev, [id, expression]: [string, string]) {
				return this.crons.some((c) => c.id === id);
			},
			run(next, [id, expression]: [string, string]) {
				const item = next.crons[this.crons.findIndex((c) => c.id === id)];
				if (item !== undefined) item.expression = expression;
			},
		},
		/** Replace one field of an expression: minute, hour, day, month or weekday. */
		setField: {
			pure: true,
			changes: ["crons"],
			pre(prev, [id, name, value]: [string, "minute" | "hour" | "day" | "month" | "weekday", string]) {
				return this.crons.some((c) => c.id === id);
			},
			run(next, [id, name, value]: [string, "minute" | "hour" | "day" | "month" | "weekday", string]) {
				const i = this.crons.findIndex((c) => c.id === id);
				const c = this.crons[i];
				if (c === undefined) return;
				const got = withField(c.expression, name, value);
				const item = next.crons[i];
				if (got !== null && item !== undefined) item.expression = got;
			},
		},
		/** Add an expression (timezone UTC); it gets the next free id (c1, c2, …). */
		addCron: {
			pure: true,
			changes: ["crons"],
			post(prev, next, [expression]: [string]) {
				return next.crons.length === prev.crons.length + 1;
			},
			run(next, [expression]: [string]) {
				const id = nextId(
					this.crons.map((c) => c.id),
					"c",
				);
				next.crons.push({ id, expression, timezone: "UTC", from: "", expectNext: "" });
			},
		},
		/** Remove an expression. pre is only checked in dev mode: the last cron stays. */
		removeCron: {
			pure: true,
			changes: ["crons", "focus"],
			pre(prev, [id]: [string]) {
				return this.crons.some((c) => c.id === id) && this.crons.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.crons.length === prev.crons.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.crons.findIndex((c) => c.id === id);
				if (i < 0 || this.crons.length <= 1) return;
				next.crons.splice(i, 1);
				if (this.focus === id) next.focus = "";
			},
		},
		/** Move an expression to a position (0 is first). */
		reorderCrons: {
			pure: true,
			changes: ["crons"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.crons.some((c) => c.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.crons.length === prev.crons.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.crons.findIndex((c) => c.id === id);
				if (i < 0) return;
				const order = movedOrder(this.crons.length, i, index);
				next.crons = order.map((j) => this.crons[j] ?? { id: "", expression: "", timezone: "", from: "", expectNext: "" });
			},
		},
		/** Change the timezone of an expression (an IANA name such as Europe/Berlin): its runs stay
		 * computed in UTC, and also read in that zone. */
		setTimezone: {
			pure: true,
			changes: ["crons"],
			pre(prev, [id, timezone]: [string, string]) {
				return this.crons.some((c) => c.id === id);
			},
			run(next, [id, timezone]: [string, string]) {
				const item = next.crons[this.crons.findIndex((c) => c.id === id)];
				if (item !== undefined) item.timezone = timezone;
			},
		},
		/** Set the ISO time an expression's runs count from, or "" for the default
		 * (2025-01-01T00:00:00Z). */
		setFrom: {
			pure: true,
			changes: ["crons"],
			constraints: {
				iso: {
					pattern:
						"^([+-]?[0-9]{4,6}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,9})?)?)? *([Zz]|[+-][0-9]{2}:?[0-9]{2})?)?$",
				},
			},
			pre(prev, [id, iso]: [string, string]) {
				return this.crons.some((c) => c.id === id);
			},
			run(next, [id, iso]: [string, string]) {
				const item = next.crons[this.crons.findIndex((c) => c.id === id)];
				if (item !== undefined) item.from = iso;
			},
		},
		/** Set the ISO time an expression's first run should be, or "" to clear it. */
		setExpectedNext: {
			pure: true,
			changes: ["crons"],
			constraints: {
				iso: {
					pattern:
						"^([+-]?[0-9]{4,6}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,9})?)?)? *([Zz]|[+-][0-9]{2}:?[0-9]{2})?)?$",
				},
			},
			pre(prev, [id, iso]: [string, string]) {
				return this.crons.some((c) => c.id === id);
			},
			run(next, [id, iso]: [string, string]) {
				const item = next.crons[this.crons.findIndex((c) => c.id === id)];
				if (item !== undefined) item.expectNext = iso;
			},
		},
		/** Which cron the builder edits. */
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
		/** From the builder: the chip at index i turns its value on or off in the focused cron. Each
		 * field has its label, then a chip per value. */
		toggleChip: {
			pure: true,
			changes: ["crons"],
			constraints: { i: { int: true, min: 0 } },
			run(next, [i]: [number]) {
				const found = this.crons.findIndex((c) => c.id === this.focus);
				const f = found < 0 ? 0 : found;
				const c = this.crons[f];
				if (c === undefined) return;
				let at = i;
				for (const k of range(0, 5)) {
					const cf = chipField(k);
					if (at === 0) return;
					if (at <= cf.count) {
						const got = toggle(c.expression, cf.name, cf.low + at - 1);
						const item = next.crons[f];
						if (got !== null && item !== undefined) item.expression = got;
						return;
					}
					at -= cf.count + 1;
				}
			},
		},
		// The rows' own, by the row's key.
		focusAt: {
			pure: true,
			changes: ["focus"],
			constraints: { at: { keyOf: "crons" } },
			run(next, [at]: [number | null]) {
				const c = at === null ? undefined : this.crons[at];
				if (c !== undefined) next.focus = c.id;
			},
		},
		setExpressionAt: {
			pure: true,
			changes: ["crons"],
			constraints: { at: { keyOf: "crons" } },
			run(next, [at, expression]: [number | null, string]) {
				if (at === null) return;
				const item = next.crons[at];
				if (item !== undefined) item.expression = expression;
			},
		},
		setTimezoneAt: {
			pure: true,
			changes: ["crons"],
			constraints: { at: { keyOf: "crons" } },
			run(next, [at, timezone]: [number | null, string]) {
				if (at === null) return;
				const item = next.crons[at];
				if (item !== undefined) item.timezone = timezone;
			},
		},
		removeCronAt: {
			pure: true,
			changes: ["crons", "focus"],
			constraints: { at: { keyOf: "crons" } },
			run(next, [at]: [number | null]) {
				const c = at === null ? undefined : this.crons[at];
				if (at === null || c === undefined || this.crons.length <= 1) return;
				next.crons.splice(at, 1);
				if (this.focus === c.id) next.focus = "";
			},
		},
	},
	loops: {
		cronRows: {
			enrich(key: number, row: CronRow) {
				return { passed: row.status === "pass", failed: row.status === "fail" };
			},
		},
		chips: {
			enrich(key: number, chip: Chip) {
				const cls =
					chip.status === "on"
						? "btn btn-xs min-h-0 h-6 px-1 font-mono btn-primary"
						: chip.status === "off"
							? "btn btn-xs min-h-0 h-6 px-1 font-mono btn-ghost opacity-60"
							: "basis-full pt-1 text-left opacity-60";
				return { chipClass: cls };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-3" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "Cron lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		div(
			{ class: "flex flex-col gap-2" },
			each(
				field("cronRows"),
				div(
					{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-2" },
					div(
						{ class: "join w-full" },
						button(
							{ class: "btn btn-sm join-item font-mono", title: "Edit in the builder", "on:click": send("focusAt", sourceKey()) },
							field("id"),
						),
						input({
							class: "input input-sm input-bordered join-item flex-1 font-mono",
							"aria-label": "Expression",
							value: field("expression"),
							"on:input": send("setExpressionAt", sourceKey(), targetValue()),
						}),
						input({
							class: "input input-sm input-bordered join-item w-40",
							"aria-label": "Timezone",
							value: field("timezone"),
							"on:input": send("setTimezoneAt", sourceKey(), targetValue()),
						}),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeCronAt", sourceKey()) },
							"✕",
						),
					),
					when(
						field("error"),
						p({ class: "text-sm text-error" }, field("error")),
						p({ class: "text-sm font-semibold" }, field("description")),
					),
					when(lookupBind("passed"), span({ class: "badge badge-success" }, field("statusText"))),
					when(lookupBind("failed"), span({ class: "badge badge-error" }, field("statusText"))),
					p({ class: "text-xs opacity-60" }, field("fromLabel")),
					ul({ class: "font-mono text-xs" }, each(field("runs"), li({}, field("text")))),
				),
				"cronRows",
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addCron", "* * * * *") }, "+ Expression"),
		),
		h3(
			{ class: "text-xs font-semibold uppercase tracking-wide opacity-60" },
			"Builder · ",
			span({ class: "font-mono normal-case" }, field("focusLabel")),
		),
		p({ class: "text-xs opacity-60" }, "Click a value to add it to or remove it from the field."),
		div(
			{ class: "flex flex-wrap items-center gap-0.5 text-xs" },
			each(
				field("chips"),
				button({ class: lookupBind("chipClass"), title: field("title"), "on:click": send("toggleChip", sourceKey()) }, field("label")),
				"chips",
			),
		),
	),
};

export const register = { CronLab: "CronLab" };
