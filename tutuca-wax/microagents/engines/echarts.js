// Host functions for echarts-lab: Apache ECharts options drawn to SVG
// without a DOM (server-side rendering), against tables. A table is
// { id, rows } or { id, csv, delimiter? }, as in vega.js, whose table and
// JSON pointer helpers this shares. The lab puts every table first in the
// option's dataset as { id, source: rows }.
//
//   echarts_tables(tables)                  [{ id, kind, count, columns: [{ name, type }], rows }]
//   echarts_describe(tables)                per table: rows, each column's type, min, max, distinct and nulls, 3 sample rows
//   echarts_check(option, tables, w, h)     { ok, errors, warnings, series, svgBytes, svg }: the option drawn w × h
//   echarts_patch(doc, pointer, value)      doc with value at pointer; throws why it can't
//   echarts_remove(doc, pointer)            doc without what pointer names; throws why it can't
//   echarts_format_csv(rows, delimiter)     rows as CSV text
import { cached, columnsOf, describe, formatCsv, isObject, patchAt, readTables, removeAt } from "./vega.js";

export const bundle = "echarts";

const SERIES = [
	"bar",
	"boxplot",
	"candlestick",
	"custom",
	"effectScatter",
	"funnel",
	"gauge",
	"graph",
	"heatmap",
	"line",
	"lines",
	"map",
	"parallel",
	"pictorialBar",
	"pie",
	"radar",
	"sankey",
	"scatter",
	"sunburst",
	"themeRiver",
	"tree",
	"treemap",
];

const asList = (v) => (Array.isArray(v) ? v : isObject(v) ? [v] : []);

// The option with every table first in its dataset, as { id, source: rows },
// then the option's own datasets (transforms of the tables, say). Copies.
const fullOption = (option, tables) => {
	const ids = new Set(tables.map((x) => x.id));
	return {
		...structuredClone(option),
		dataset: [...tables.map((x) => ({ id: x.id, source: x.rows.map((r) => ({ ...r })) })), ...asList(structuredClone(option.dataset)).filter((d) => !ids.has(d?.id))],
	};
};

// What's wrong with option before ECharts sees it: unknown series types and
// dataset ids are errors, encoded columns a dataset doesn't have are warnings.
const precheck = (option, tables, errors, warnings) => {
	// Dataset id → its columns, or null when a transform makes columns the lab can't tell.
	const columns = new Map(tables.map((x) => [x.id, x.columns.map((c) => c.name)]));
	const first = tables[0]?.id;
	for (const d of asList(option.dataset)) {
		if (!isObject(d)) continue;
		const from = d.fromDatasetId;
		if (typeof from === "string" && !columns.has(from)) errors.push(`dataset "${d.id ?? "?"}" reads fromDatasetId "${from}", which isn't a table or dataset`);
		if (typeof d.id !== "string" || columns.has(d.id)) continue;
		const keeps = asList(d.transform).every((x) => ["filter", "sort"].includes(x?.type));
		if (Array.isArray(d.source)) columns.set(d.id, isObject(d.source[0]) ? columnsOf(d.source).map((c) => c.name) : null);
		else columns.set(d.id, keeps ? (columns.get(from) ?? null) : null);
	}
	const series = asList(option.series);
	if (series.length === 0) warnings.push("the option has no series, so nothing is drawn");
	series.forEach((s, i) => {
		if (!isObject(s)) return;
		if (!SERIES.includes(s.type)) errors.push(`series ${i} has type ${JSON.stringify(s.type)}; types are ${SERIES.join(", ")}`);
		const id = s.datasetId ?? (s.datasetIndex === undefined ? first : undefined);
		if (typeof s.datasetId === "string" && !columns.has(s.datasetId)) {
			errors.push(`series ${i} reads datasetId "${s.datasetId}", which isn't a table or dataset; they are ${[...columns.keys()].join(", ") || "none"}`);
			return;
		}
		const cols = s.data === undefined && id !== undefined ? columns.get(id) : null;
		if (!cols || !isObject(s.encode)) return;
		for (const name of Object.values(s.encode).flat()) {
			if (typeof name === "string" && !cols.includes(name)) warnings.push(`series ${i} encodes "${name}", but dataset "${id}" has columns ${cols.join(", ")}`);
		}
	});
};

export const make = (echarts) => {
	// The option drawn to SVG: ECharts' warnings go to the console, so they
	// are caught meanwhile. The chart is always disposed.
	const check = cached((option, raw, width, height) => {
		const errors = [];
		const warnings = [];
		let svg = "";
		const series = asList(isObject(option) ? option.series : null).map((s) => ({ type: s?.type ?? null, datasetId: s?.datasetId ?? null }));
		const out = () => ({ ok: errors.length === 0, errors, warnings, series, svgBytes: svg.length, svg: errors.length === 0 ? svg : "" });
		if (!isObject(option)) {
			errors.push("the option must be a JSON object");
			return out();
		}
		const tables = readTables(raw);
		precheck(option, tables, errors, warnings);
		if (errors.length > 0) return out();
		const chart = echarts.init(null, null, { ssr: true, renderer: "svg", width: width || 600, height: height || 400 });
		const { warn, error: logError } = console;
		console.warn = (...a) => warnings.push(a.join(" "));
		console.error = (...a) => errors.push(a.join(" "));
		try {
			chart.setOption(fullOption(option, tables), true);
			svg = chart.renderToSVGString();
		} catch (e) {
			errors.push(`ECharts can't draw the option: ${e.message}`);
		} finally {
			console.warn = warn;
			console.error = logError;
			chart.dispose();
		}
		return out();
	}, 16);
	return {
		echarts_tables: cached((tables) => readTables(tables), 16),
		echarts_describe: (tables) => readTables(tables).map(describe),
		echarts_check: check,
		echarts_patch: patchAt,
		echarts_remove: removeAt,
		echarts_format_csv: (rows, delimiter) => formatCsv(Array.isArray(rows) ? rows.filter(isObject) : [], delimiter || ","),
	};
};
