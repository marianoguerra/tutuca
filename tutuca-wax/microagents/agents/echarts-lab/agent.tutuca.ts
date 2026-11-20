// echarts-lab: one Apache ECharts option drawn from tables bound by id. A table is { id, rows }
// (an array of row objects) or { id, csv, delimiter? } (CSV text). The lab puts every table first
// in the option's dataset as { id, source: rows }; a series reads one with datasetId and picks its
// columns with encode. ECharts draws the option to SVG in the page, without a DOM
// (microagents/echarts, microagents/engines/echarts.js), and the view shows that SVG. The root's
// messages are the agent's tools; the editor and the table list send messages of their own, by
// the row's key.
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
	li,
	p,
	send,
	sourceKey,
	span,
	table,
	targetValue,
	tbody,
	td,
	textarea,
	th,
	thead,
	tr,
	ul,
	when,
} from "tutuca/view";
import { get, range, toJson } from "tutuca/data";
import { check, describe, formatCsv, objectOf, parse, patch, readTables, remove } from "microagents/echarts";

export type Row = { [key: string]: unknown };
/** A table: rows (an array of objects), or CSV text with a header row (delimiter "," unless it
 * says). */
export type Table = { id: string; rows: Row[] } | { id: string; csv: string } | { id: string; csv: string; delimiter: string };
export type Column = { name: string; type: string };
/** A table as the page reads it. */
export type Info = { id: string; kind: string; count: number; columns: Column[]; rows: Row[] };

const PREVIEW_ROWS = 8;
const CLIP_AT = 1500;
const NOT_OBJECT = "the option must be a JSON object with at least one key";
const LEFT_EMPTY = "that leaves the option empty: replace it whole with setOption instead";
const WIDTH = 600;
const HEIGHT = 400;

/** text, cut at n characters. */
function clip(text: string, n: number): string {
	return text.length <= n ? text : `${text.slice(0, n)}…`;
}

/** A cell's value as text: a string as itself, null as "", the rest as JSON. */
function cellText(v: unknown): string {
	if (typeof v === "string") return v;
	if (v === null || v === undefined) return "";
	return toJson(v, 0);
}

/** "month: date, revenue: integer". */
function columnsText(info: Readonly<Info>): string {
	return info.columns.map((c) => `${c.name}: ${c.type}`).join(", ");
}

/** "sales · table · 8 rows". */
function tableLabel(info: Readonly<Info>): string {
	return `${info.id} · ${info.kind} · ${info.rows.length} rows`;
}

/** A table with id and rows; a CSV table (the old one's csv is a string) stays CSV, with its
 * delimiter. */
function tableOf(id: string, rows: Readonly<Row[]>, oldCsv: unknown, delimiter: unknown): Table {
	if (typeof oldCsv === "string") {
		if (typeof delimiter === "string") {
			const csv = formatCsv(rows, delimiter);
			if (csv !== "") return { id, csv, delimiter };
		} else {
			const csv = formatCsv(rows, ",");
			if (csv !== "") return { id, csv };
		}
	}
	return { id, rows: rows.map((r) => r) };
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

export type EchartsLab = {
	/** The ECharts option, a JSON object; its series read a table with "datasetId": "<table id>" and
	 * encode. */
	option: { [key: string]: unknown };
	/** The tables the option reads; the first is the default dataset, by id: rows (an array of
	 * objects) or CSV text with a header row (delimiter "," unless it says). */
	tables: Table[];
	/** The option as the user edits it; "" until it's edited. */
	optionText: string;
	/** Why optionText isn't an option; "" when it is (and option is its value). */
	optionError: string;
	/** Why the last setOption, patchOption or removeOptionKey changed nothing; "" when it worked. */
	editError: string;
	/** The table the preview shows; "" for the first. */
	focus: string;
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	/** Whether the option draws: errors, warnings, the tables, the series and the SVG's size. */
	readonly compileReport: unknown;
	/** What an option edit answers with: compileReport, or { error } when the edit changed nothing. */
	readonly editReport: unknown;
	/** Every table's columns with type, min, max, distinct and null counts, and 3 sample rows. */
	readonly describeTables: unknown;
	readonly errorList: { text: string }[];
	readonly warningList: { text: string }[];
	readonly canRender: boolean;
	/** The chart as SVG text, drawn 600 × 400; "" when the option doesn't draw. */
	readonly chartSvg: string;
	/** The option as JSON text, as the editor shows it. */
	readonly editorText: string;
	readonly tableRows: { id: string; label: string; on: boolean }[];
	readonly hasTables: boolean;
	readonly previewTitle: string;
	readonly previewColumns: Column[];
	readonly previewRows: { cells: { text: string }[] }[];
	/** The index of the table the preview shows: focus's, or the first's. */
	readonly focused: number;
};

export const EchartsLab = {
	implements: ["MicroAgent"],
	defaults: { tables: [], optionText: "", optionError: "", editError: "", focus: "" },
	constraints: { option: { minLength: 1 } },
	queries: {
		get focused(): number {
			const i = this.tables.findIndex((t) => t.id === this.focus);
			return i < 0 ? 0 : i;
		},
		get compileReport(): unknown {
			const r = check(this.option, this.tables, WIDTH, HEIGHT);
			return { ok: r.ok, errors: r.errors, warnings: r.warnings, series: r.series, svgBytes: r.svgBytes, tables: this.tables.map((t) => t.id) };
		},
		get editReport(): unknown {
			if (this.editError !== "") return { error: this.editError };
			return this.compileReport;
		},
		get describeTables(): unknown {
			return describe(this.tables);
		},
		get errorList() {
			return check(this.option, this.tables, WIDTH, HEIGHT).errors.map((e) => ({ text: e }));
		},
		get warningList() {
			return check(this.option, this.tables, WIDTH, HEIGHT).warnings.map((w) => ({ text: w }));
		},
		get canRender(): boolean {
			return check(this.option, this.tables, WIDTH, HEIGHT).ok;
		},
		get chartSvg(): string {
			return check(this.option, this.tables, WIDTH, HEIGHT).svg;
		},
		get editorText(): string {
			return this.optionText !== "" ? this.optionText : toJson(this.option, 2);
		},
		get headline(): string {
			const r = check(this.option, this.tables, WIDTH, HEIGHT);
			return r.ok ? `draws · ${r.warnings.length} warnings` : `${r.errors.length} errors`;
		},
		get tableRows() {
			const focused = this.focused;
			return readTables(this.tables).map((info, i) => ({
				id: info.id,
				label: `${tableLabel(info)} · ${columnsText(info)}`,
				on: i === focused,
			}));
		},
		get hasTables(): boolean {
			return this.tables.length > 0;
		},
		get previewTitle(): string {
			const info = readTables(this.tables).at(this.focused);
			if (info === undefined) return "";
			const shown = Math.min(info.rows.length, PREVIEW_ROWS);
			return `${tableLabel(info)} (showing ${shown})`;
		},
		get previewColumns(): Column[] {
			const info = readTables(this.tables).at(this.focused);
			if (info === undefined) return [];
			return info.columns;
		},
		get previewRows() {
			const out: { cells: { text: string }[] }[] = [];
			const info = readTables(this.tables).at(this.focused);
			if (info === undefined) return out;
			for (const row of info.rows.slice(0, PREVIEW_ROWS)) {
				out.push({ cells: info.columns.map((c) => ({ text: cellText(get(row, c.name)) })) });
			}
			return out;
		},
		get summary(): string {
			const r = check(this.option, this.tables, WIDTH, HEIGHT);
			const infos = readTables(this.tables);
			const lines = [`ECharts option: ${this.headline}.`, `tables (${infos.length}):`];
			for (const info of infos) lines.push(`  ${tableLabel(info)}: ${columnsText(info)}`);
			for (const e of r.errors) lines.push(`error: ${e}`);
			for (const w of r.warnings) lines.push(`warning: ${w}`);
			if (this.optionError !== "") lines.push(`the editor's text isn't an option yet (the option is the last one that was): ${this.optionError}`);
			lines.push("option:");
			lines.push(clip(toJson(this.option, 2), CLIP_AT));
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { option, tables }. */
		get data(): unknown {
			return { option: this.option, tables: this.tables };
		},
		get domain(): unknown {
			return { option: this.option, tables: this.tables };
		},
	},
	on: {
		/** Replace the whole ECharts option (a JSON object). Series read tables with datasetId and
		 * encode. */
		setOption: {
			pure: true,
			changes: ["option", "optionText", "optionError", "editError"],
			constraints: { option: { minLength: 1 } },
			run(next, [option]: [{ [key: string]: unknown }]) {
				const s = objectOf(option);
				if (Object.keys(s).length === 0) {
					next.editError = NOT_OBJECT;
					return;
				}
				next.option = s;
				next.optionText = "";
				next.optionError = "";
				next.editError = "";
			},
		},
		/** The option's text, from its editor: kept while it isn't a JSON object. */
		setOptionText: {
			pure: true,
			changes: ["option", "optionText", "optionError", "editError"],
			run(next, [text]: [string]) {
				next.optionText = text;
				next.editError = "";
				const r = parse(text);
				if (r.error !== "") {
					next.optionError = r.error;
					return;
				}
				const s = objectOf(r.value);
				if (Object.keys(s).length === 0) {
					next.optionError = NOT_OBJECT;
					return;
				}
				next.option = s;
				next.optionError = "";
			},
		},
		/** Set one value in the option at a JSON pointer such as /series/0/encode/y (/- appends to an
		 * array). The value is JSON as itself (an object, not its JSON text). The parent must exist:
		 * to style a series without lineStyle, set /series/0/lineStyle to {"color": "red"}, not
		 * /series/0/lineStyle/color. */
		patchOption: {
			pure: true,
			changes: ["option", "optionText", "optionError", "editError"],
			constraints: { pointer: { pattern: "^/" } },
			run(next, [pointer, value]: [string, unknown]) {
				const r = patch(this.option, pointer, value);
				if (r.error !== "") {
					next.editError = r.error;
					return;
				}
				const s = objectOf(r.value);
				if (Object.keys(s).length === 0) {
					next.editError = LEFT_EMPTY;
					return;
				}
				next.option = s;
				next.optionText = "";
				next.optionError = "";
				next.editError = "";
			},
		},
		/** Remove the value at a JSON pointer from the option. */
		removeOptionKey: {
			pure: true,
			changes: ["option", "optionText", "optionError", "editError"],
			constraints: { pointer: { pattern: "^/" } },
			run(next, [pointer]: [string]) {
				const r = remove(this.option, pointer);
				if (r.error !== "") {
					next.editError = r.error;
					return;
				}
				const s = objectOf(r.value);
				if (Object.keys(s).length === 0) {
					next.editError = LEFT_EMPTY;
					return;
				}
				next.option = s;
				next.optionText = "";
				next.optionError = "";
				next.editError = "";
			},
		},
		/** Replace a table's rows, or add a table with this id; rows is an array of objects. A CSV
		 * table stays CSV. */
		setTable: {
			pure: true,
			changes: ["tables"],
			constraints: { id: { pattern: "^[A-Za-z0-9_-]+$" } },
			run(next, [id, rows]: [string, Row[]]) {
				const i = this.tables.findIndex((t) => t.id === id);
				const old = this.tables[i];
				if (old === undefined) next.tables.push(tableOf(id, rows, null, null));
				else next.tables[i] = tableOf(id, rows, get(old, "csv"), get(old, "delimiter"));
			},
		},
		/** Remove a table. */
		removeTable: {
			pure: true,
			changes: ["tables", "focus"],
			pre(prev, [id]: [string]) {
				return this.tables.some((t) => t.id === id);
			},
			post(prev, next, [id]: [string]) {
				return next.tables.length === prev.tables.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.tables.findIndex((t) => t.id === id);
				if (i < 0) return;
				next.tables.splice(i, 1);
				if (this.focus === id) next.focus = "";
			},
		},
		/** Move a table to a position (0 is first): the first one is the option's default dataset. */
		reorderTables: {
			pure: true,
			changes: ["tables"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.tables.some((t) => t.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.tables.length === prev.tables.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.tables.findIndex((t) => t.id === id);
				if (i < 0) return;
				const order = movedOrder(this.tables.length, i, index);
				next.tables = order.map((j) => this.tables[j] ?? { id: "", csv: "" });
			},
		},
		/** Which table the preview shows. */
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
		// The table list's own, by the row's key.
		focusAt: {
			pure: true,
			changes: ["focus"],
			constraints: { at: { keyOf: "tables" } },
			run(next, [at]: [number | null]) {
				const t = at === null ? undefined : this.tables[at];
				if (t !== undefined) next.focus = t.id;
			},
		},
		removeTableAt: {
			pure: true,
			changes: ["tables", "focus"],
			constraints: { at: { keyOf: "tables" } },
			run(next, [at]: [number | null]) {
				const t = at === null ? undefined : this.tables[at];
				if (at === null || t === undefined) return;
				next.tables.splice(at, 1);
				if (this.focus === t.id) next.focus = "";
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "ECharts lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		when(
			field("canRender"),
			h("ma-svg", { class: "block w-full overflow-x-auto", svg: field("chartSvg") }),
			p({ class: "text-sm opacity-60" }, "The chart shows once the option draws."),
		),
		ul({ class: "flex flex-col gap-1 text-sm text-error" }, each(field("errorList"), li({}, field("text")))),
		ul({ class: "flex flex-col gap-1 text-sm text-warning" }, each(field("warningList"), li({}, field("text")))),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Option"),
		textarea({
			class: "textarea textarea-bordered w-full font-mono text-xs",
			rows: "16",
			"aria-label": "Option JSON",
			value: field("editorText"),
			"on:input": send("setOptionText", targetValue()),
		}),
		when(field("optionError"), p({ class: "text-xs text-error" }, field("optionError"))),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Tables"),
		when(
			field("hasTables"),
			div(
				{ class: "flex flex-col gap-1" },
				each(
					field("tableRows"),
					div(
						{ class: "join w-full" },
						button(
							{
								class: when(
									field("on"),
									"btn btn-sm btn-active join-item flex-1 justify-start font-mono",
									"btn btn-sm join-item flex-1 justify-start font-mono",
								),
								title: "Preview this table",
								"on:click": send("focusAt", sourceKey()),
							},
							field("label"),
						),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeTableAt", sourceKey()) },
							"✕",
						),
					),
				),
			),
			p({ class: "text-sm opacity-60" }, "No tables yet: the model adds them with setTable."),
		),
		when(
			field("hasTables"),
			div(
				{ class: "flex flex-col gap-1" },
				p({ class: "text-xs opacity-60" }, field("previewTitle")),
				div(
					{ class: "overflow-x-auto rounded-box border border-base-300" },
					table(
						{ class: "table table-xs" },
						thead({}, tr({}, each(field("previewColumns"), th({ class: "font-mono" }, field("name"), span({ class: "opacity-50" }, " ", field("type")))))),
						tbody({}, each(field("previewRows"), tr({}, each(field("cells"), td({}, field("text")))))),
					),
				),
			),
		),
	),
};

export const register = { EchartsLab: "EchartsLab" };
