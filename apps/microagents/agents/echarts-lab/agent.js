// echarts-lab: one ECharts option (an "echarts" part) drawn from tables bound by id. A table is
// a "table" part (an array of row objects) or a "csv" part (CSV text, its delimiter and header
// flag in the meta dialect https://tutuca.dev/d/csv). The lab passes the tables as the option's
// dataset, [{ id, source: rows }], and series name theirs with datasetId and pick columns with
// encode. The root's handlers are the tools; the editor and the model edit through them.
export default async function define(kit) {
	const { apply, component, field, $if, render, t, tag } = kit.tutuca;
	const { fromJson, message, toJson } = kit.tdata;
	const {
		clip,
		isObject,
		jsonTextKind,
		parse: parseJson,
		pointer,
		pretty,
		preview,
		sameAsPart,
	} = kit.lib.json;
	const { KINDS, columnsOf, describe, readPart, writePart } = kit.lib.table;
	const { encodeParts, kidsOf, withPart } = kit.lib.parts;
	const { labHeader, listHandlers, listOf, messageList, section } = kit.ui;
	const { div, p } = tag;
	const echarts = await kit.engines.echarts();
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

	// The option text changed at a JSON pointer ("/series/0/encode/y") by change, pointer.set or
	// pointer.remove of kit.lib.json; null when the option isn't an object or the pointer is bad.
	const patchText = (text, at, change) => {
		const { value: doc } = parseJson(text);
		if (!isObject(doc) || !at.startsWith("/")) return null;
		const out = change(doc, at);
		return out.error === undefined ? pretty(out.value) : null;
	};
	// Why patchText gives null, in words for the model.
	const patchWhy = (text, at, change) => {
		const { value: doc } = parseJson(text);
		if (!isObject(doc)) return "the option isn't a JSON object: replace it whole";
		if (!at.startsWith("/")) return `a pointer starts with /, ${JSON.stringify(at)} doesn't`;
		return change(doc, at).error ?? "";
	};
	// A value sent as JSON text for an object or an array is refused: no ECharts or Vega-Lite
	// value is one, and storing it would put a string where the object belongs.
	const setTo = (value) => (doc, at) => {
		const kind = jsonTextKind(value);
		return kind === ""
			? pointer.set(doc, at, value)
			: {
					error: `the value is a string holding JSON text for an ${kind}: send the ${kind} itself, not encoded as a string`,
				};
	};

	// The option with every table first in its dataset, as { id, source: rows }, then the
	// option's own datasets (transforms of the tables, say). Copies: state is frozen.
	const asList = (v) => (Array.isArray(v) ? v : isObject(v) ? [v] : []);
	const fullOption = (option, tables) => {
		const ids = new Set(tables.map((x) => x.id));
		return {
			...structuredClone(option),
			dataset: [
				...tables.map((x) => ({ id: x.id, source: x.rows.map((r) => ({ ...r })) })),
				...asList(structuredClone(option.dataset)).filter((d) => !ids.has(d?.id)),
			],
		};
	};
	// What's wrong with option before ECharts sees it: unknown series types and dataset ids are
	// errors, encoded columns a dataset doesn't have are warnings.
	const precheck = (option, tables, errors, warnings) => {
		// Dataset id → its columns, or null when a transform makes columns the lab can't tell.
		const columns = new Map(tables.map((x) => [x.id, columnsOf(x.rows).map((c) => c.name)]));
		const first = tables[0]?.id;
		for (const d of asList(option.dataset)) {
			if (!isObject(d)) continue;
			const from = d.fromDatasetId;
			if (typeof from === "string" && !columns.has(from)) {
				errors.push(
					`dataset "${d.id ?? "?"}" reads fromDatasetId "${from}", which isn't a table or dataset`,
				);
			}
			if (typeof d.id !== "string" || columns.has(d.id)) continue;
			const keeps = asList(d.transform).every((x) => ["filter", "sort"].includes(x?.type));
			if (Array.isArray(d.source))
				columns.set(d.id, isObject(d.source[0]) ? Object.keys(d.source[0]) : null);
			else columns.set(d.id, keeps ? (columns.get(from) ?? null) : null);
		}
		const series = asList(option.series);
		if (series.length === 0) warnings.push("the option has no series, so nothing is drawn");
		series.forEach((s, i) => {
			if (!isObject(s)) return;
			if (!SERIES.includes(s.type)) {
				errors.push(
					`series ${i} has type ${JSON.stringify(s.type)}; types are ${SERIES.join(", ")}`,
				);
			}
			const id = s.datasetId ?? (s.datasetIndex === undefined ? first : undefined);
			if (typeof s.datasetId === "string" && !columns.has(s.datasetId)) {
				errors.push(
					`series ${i} reads datasetId "${s.datasetId}", which isn't a table or dataset; they are ${[...columns.keys()].join(", ") || "none"}`,
				);
				return;
			}
			const cols = s.data === undefined && id !== undefined ? columns.get(id) : null;
			if (!cols || !isObject(s.encode)) return;
			for (const name of Object.values(s.encode).flat()) {
				if (typeof name === "string" && !cols.includes(name)) {
					warnings.push(
						`series ${i} encodes "${name}", but dataset "${id}" has columns ${cols.join(", ")}`,
					);
				}
			}
		});
	};
	// { ok, errors, warnings, series, svgBytes } for option text and tables: ECharts draws the
	// option to SVG without a DOM. Its warnings go to the console, so they are caught meanwhile.
	const check = (text, tables) => {
		const errors = [];
		const warnings = [];
		let svgBytes = 0;
		const out = (series = []) => ({ ok: errors.length === 0, errors, warnings, series, svgBytes });
		if (text.trim() === "") {
			errors.push("there is no option yet: set one with set_option");
			return out();
		}
		const { value: option, error } = parseJson(text);
		if (error) errors.push(`the option isn't valid JSON: ${error}`);
		else if (!isObject(option)) errors.push("the option must be a JSON object");
		if (errors.length > 0) return out();
		precheck(option, tables, errors, warnings);
		const series = asList(option.series).map((s) => ({
			type: s?.type ?? null,
			datasetId: s?.datasetId ?? null,
		}));
		if (errors.length > 0) return out(series);
		const chart = echarts.init(null, null, { ssr: true, renderer: "svg", width: 600, height: 400 });
		const { warn, error: logError } = console;
		console.warn = (...a) => warnings.push(a.join(" "));
		console.error = (...a) => errors.push(a.join(" "));
		try {
			chart.setOption(fullOption(option, tables), true);
			svgBytes = chart.renderToSVGString().length;
		} catch (e) {
			errors.push(`ECharts can't draw the option: ${e.message}`);
		} finally {
			console.warn = warn;
			console.error = logError;
			chart.dispose();
		}
		return out(series);
	};
	// Getters run on every render: the last report is kept per tables (state doesn't change in
	// place), with the option text it is for.
	const reports = new WeakMap();
	const reportOf = (self) => {
		const last = reports.get(self.tables.items);
		if (last?.text === self.optionText) return last.report;
		const report = check(self.optionText, self.tables.items);
		reports.set(self.tables.items, { text: self.optionText, report });
		return report;
	};

	// The option's editor: a JsonView whose text is the option's text.
	const optionEditor = (text) => ({
		id: "option",
		label: "Option",
		text,
		mode: "tree",
		editable: true,
		on: "set_option_text",
		rows: 16,
	});
	// The first edit of an empty lab makes its option part.
	const claim = (self, next) => {
		if (self.optionId === "") next.optionId = "option";
	};

	const EChartsLab = component({
		name: "EChartsLab",
		fields: {
			optionId: t.string(), // The echarts part's id; "" until there is one.
			optionView: t.component("JsonView"), // Its text is the option's text.
			tables: t.component("List"),
		},
		methods: {
			tableById(id) {
				return this.tables.items.find((x) => x.id === id);
			},
			toDomain() {
				const { value } = parseJson(this.optionText);
				return {
					option: value === undefined ? null : structuredClone(value),
					optionText: this.optionText,
					tables: this.tables.items.map(({ id, kind, rows }) => ({ id, kind, rows })),
				};
			},
		},
		queries: {
			get optionText() {
				return this.optionView?.text ?? "";
			},
			// view tool: whether the option draws, and why not.
			get compile_report() {
				const { ok, errors, warnings, series, svgBytes } = reportOf(this);
				return {
					ok,
					errors,
					warnings,
					tables: this.tables.items.map((x) => x.id),
					series,
					svgBytes,
				};
			},
			get errorList() {
				return reportOf(this).errors;
			},
			get warningList() {
				return reportOf(this).warnings;
			},
			get canRender() {
				return reportOf(this).ok;
			},
			// The option as the chart element draws it: tables in its dataset.
			get chartOption() {
				if (!reportOf(this).ok) return "";
				return JSON.stringify(fullOption(parseJson(this.optionText).value, this.tables.items));
			},
			get headline() {
				const { ok, errors, warnings } = reportOf(this);
				return ok ? `draws · ${warnings.length} warnings` : `${errors.length} errors`;
			},
			get summary() {
				const { errors, warnings } = reportOf(this);
				return [
					`ECharts option ${this.optionId || "(none yet)"}: ${this.headline}.`,
					`tables (${this.tables.items.length}):`,
					...this.tables.items.map(
						(x) =>
							`  ${x.id} (${x.label}): ${x.columns.map((c) => `${c.name}: ${c.type}`).join(", ")}`,
					),
					...errors.map((e) => `error: ${e}`),
					...warnings.map((w) => `warning: ${w}`),
					"option:",
					clip(this.optionText, 1500),
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("ECharts lab"),
			$if(
				field("canRender"),
				tag["ma-echart"]({ class: "block h-96 w-full", option: field("chartOption") }),
				p({ class: "text-sm opacity-60" }, "The chart shows once the option draws."),
			),
			messageList("errorList"),
			messageList("warningList", "text-warning"),
			render(field("optionView")),
			section("Tables"),
			render(field("tables")),
		),
		on: {
			// The tables: drag to reorder (the first one is the option's default dataset), remove and
			// reorder_tables. Tables come from set_table, so the list has no add button.
			...listHandlers("tables"),
			set_option: {
				pure: true,
				args: [t.any()],
				pre: (_self, [option]) => isObject(option),
				run(next, [option]) {
					next.optionView = apply(next.optionView, "set_text", pretty(option));
					claim(this, next);
				},
			},
			// The editor's edits: [its id, the text].
			set_option_text: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [, text]) {
					next.optionView = apply(next.optionView, "set_text", text);
					claim(this, next);
				},
			},
			patch_option: {
				pure: true,
				args: [t.string(), t.any()],
				pre: (self, [at, value]) => patchText(self.optionText, at, setTo(value)) !== null,
				why: (self, [at, value]) => patchWhy(self.optionText, at, setTo(value)),
				run(next, [at, value]) {
					next.optionView = apply(
						next.optionView,
						"set_text",
						patchText(this.optionText, at, setTo(value)),
					);
				},
			},
			remove_option_key: {
				pure: true,
				args: [t.string()],
				pre: (self, [at]) => patchText(self.optionText, at, pointer.remove) !== null,
				why: (self, [at]) => patchWhy(self.optionText, at, pointer.remove),
				run(next, [at]) {
					next.optionView = apply(
						next.optionView,
						"set_text",
						patchText(this.optionText, at, pointer.remove),
					);
				},
			},
			set_table: {
				args: [t.string(), t.array(t.any())],
				pre: (_self, [id, rows]) => /^[\w-]+$/.test(id) && rows.every(isObject),
				run(next, [id, rows], ctx) {
					const i = this.tables.items.findIndex((x) => x.id === id);
					if (i < 0) {
						const table = ctx.scope.make("DataTable", { id, kind: "table", rows, edited: true });
						next.tables = apply(next.tables, "add_item", table);
					} else {
						next.tables.items[i] = apply(next.tables.items[i], "set_rows", rows);
					}
				},
			},
			remove_table: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.tableById(id) !== undefined,
				run(next, [id]) {
					const i = this.tables.items.findIndex((x) => x.id === id);
					next.tables = apply(next.tables, "remove_item_at", i);
				},
			},
		},
	});

	// How the chat shows a call answered with compile_report: one line with what the call did,
	// in the option's terms (glimpse(arguments)), and whether the option draws, opening to the
	// errors and warnings.
	const reportCall = (name, glimpse) =>
		component({
			name,
			fields: { ...kit.ui.toolCallFields },
			queries: kit.ui.toolCallQueriesWith({
				get glimpse() {
					return glimpse(this.call?.arguments ?? {});
				},
				// The compile_report the call answered with, or null.
				get report() {
					if (!this.result || this.result.isError) return null;
					return isObject(this.resultJson) ? this.resultJson : null;
				},
				get errorList() {
					return this.report?.errors ?? [];
				},
				get warningList() {
					return this.report?.warnings ?? [];
				},
				get state() {
					if (!this.result) return "running";
					if (this.result.isError) return this.resultText || "failed";
					if (this.report === null) return "ok";
					return this.report.ok
						? `draws · ${this.warningList.length} warnings`
						: `${this.errorList.length} errors`;
				},
				// Red when it failed or doesn't draw, amber when it draws with warnings.
				get stateClass() {
					const bad = this.report?.ok === false;
					return !bad && this.warningList.length > 0
						? kit.ui.callStateClass(this.result).replace("badge-success", "badge-warning")
						: kit.ui.callStateClass(this.result, bad);
				},
			}),
			view: kit.ui.toolCallFrame(
				"glimpse",
				messageList("errorList"),
				messageList("warningList", "text-warning"),
			),
		});
	// patch_option: "/series/0/encode/y = "a"".
	const PatchOptionCall = reportCall(
		"PatchOptionCall",
		({ pointer: at = "?", value }) => `${at} = ${preview(value, 60)}`,
	);
	// set_option: its series' types and datasets, "line climate, bar sales".
	const SetOptionCall = reportCall("SetOptionCall", ({ option }) => {
		if (!isObject(option)) return preview(option, 60);
		const series = asList(option.series).map((s) =>
			isObject(s) ? [s.type ?? "?", s.datasetId].filter((x) => x !== undefined).join(" ") : "?",
		);
		return series.length === 0 ? "no series" : series.join(", ");
	});

	// Module tools: they get the root's toDomain().
	const tools = {
		describe_tables: async (domain) => ({ result: domain.tables.map(describe) }),
	};

	// The chart element: tutuca sets its option attribute and it draws with echarts.init(el).
	kit.ui.defineAttrElement("ma-echart", "option", {
		draw(el, text) {
			if (text === "") return;
			if (!el.chart) {
				el.chart = echarts.init(el, null, { renderer: "svg" });
				el.observer = new ResizeObserver(() => el.chart?.resize());
				el.observer.observe(el);
			}
			try {
				el.chart.setOption(JSON.parse(text), true);
			} catch (e) {
				console.warn("ma-echart:", e.message);
			}
		},
		dispose(el) {
			el.observer?.disconnect();
			el.chart?.dispose();
			el.chart = null;
			el.observer = null;
		},
	});

	// The root for msg: its first echarts part and its tables.
	const decode = (C, bindings, msg) => {
		const option = (bindings.options ?? kidsOf(msg, "echarts"))[0];
		return C.EChartsLab({
			optionId: option?.id ?? "",
			optionView: C.JsonView(
				optionEditor(option === undefined ? "" : pretty(toJson(option.data ?? null))),
			),
			tables: listOf(
				C,
				"tables",
				(bindings.tables ?? kidsOf(msg, KINDS)).map((m) => C.DataTable(readPart(m))),
			),
		});
	};

	// msg with root's option and tables. Unchanged parts stay the same objects; an option that
	// doesn't parse keeps the old one; tables that weren't edited stay, removed ones go, new
	// ones are added at the end (after a new option) and the table parts follow the tables' order.
	const encode = (root, msg) => {
		const { value: option } = parseJson(root.optionText);
		const ok = isObject(option);
		const withOption = withPart(
			msg,
			"echarts",
			root.optionId,
			(m) => (!ok || sameAsPart(m, root.optionText) ? m : { ...m, data: fromJson(option) }),
			() =>
				ok && root.optionId !== "" ? message(root.optionId, "echarts", fromJson(option)) : null,
		);
		const tables = {
			items: root.tables.items,
			same: (_m, x) => !x.edited,
			update: writePart,
			create: (x) => writePart(null, x),
			ordered: true,
		};
		return encodeParts(withOption, { table: tables, csv: tables });
	};

	return {
		components: { ...kit.ui.components, EChartsLab, PatchOptionCall, SetOptionCall },
		root: "EChartsLab",
		decode,
		encode,
		tools,
		toolViews: { patch_option: "PatchOptionCall", set_option: "SetOptionCall" },
	};
}
