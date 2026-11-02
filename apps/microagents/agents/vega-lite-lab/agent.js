// vega-lite-lab: one Vega-Lite spec (a "vega-lite" part) drawn from tables bound by name. A table
// is a "table" part (an array of row objects) or a "csv" part (CSV text, its delimiter and
// header flag in the meta dialect https://tutuca.dev/d/csv). The spec names a table with
// {"data": {"name": "<table id>"}} and the agent passes the tables as the spec's datasets. The
// root's handlers are the tools; the editor and the model edit the spec through them.
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
	const { vega, compile, embed } = await kit.engines.vega();
	const MARKS = [
		"arc",
		"area",
		"bar",
		"boxplot",
		"circle",
		"errorband",
		"errorbar",
		"geoshape",
		"image",
		"line",
		"point",
		"rect",
		"rule",
		"square",
		"text",
		"tick",
		"trail",
	];

	// The spec text changed at a JSON pointer ("/encoding/x/field") by change, pointer.set or
	// pointer.remove of kit.lib.json; null when the spec isn't an object or the pointer is bad.
	const patchText = (text, at, change) => {
		const { value: doc } = parseJson(text);
		if (!isObject(doc) || !at.startsWith("/")) return null;
		const out = change(doc, at);
		return out.error === undefined ? pretty(out.value) : null;
	};
	// Why patchText gives null, in words for the model.
	const patchWhy = (text, at, change) => {
		const { value: doc } = parseJson(text);
		if (!isObject(doc)) return "the spec isn't a JSON object: replace it whole";
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

	// Calls visit(key, value) on every key of every object in v.
	const walk = (v, visit) => {
		if (Array.isArray(v)) for (const x of v) walk(x, visit);
		else if (isObject(v)) {
			for (const [k, x] of Object.entries(v)) {
				visit(k, x);
				walk(x, visit);
			}
		}
	};

	// The spec with every table passed as a dataset, so {"data": {"name": id}} finds it. The rows
	// are copies: state is frozen and Vega marks the rows it reads.
	const fullSpec = (spec, tables) => {
		const copy = structuredClone(spec);
		return {
			...copy,
			datasets: {
				...(isObject(copy.datasets) ? copy.datasets : {}),
				...Object.fromEntries(tables.map((x) => [x.id, x.rows.map((r) => ({ ...r }))])),
			},
		};
	};
	// What's wrong with spec before Vega-Lite sees it: unknown marks and table names are errors,
	// fields no table has are warnings.
	const precheck = (spec, tables, errors, warnings) => {
		const names = new Set([...tables.map((x) => x.id), ...Object.keys(spec.datasets ?? {})]);
		const known = new Set(tables.flatMap((x) => columnsOf(x.rows).map((c) => c.name)));
		const knowRows = (rows) => {
			if (!Array.isArray(rows)) return;
			for (const name of columnsOf(rows.filter(isObject))) known.add(name.name);
		};
		Object.values(spec.datasets ?? {}).forEach(knowRows);
		const fields = new Set();
		walk(spec, (k, v) => {
			if (k === "mark") {
				const type = isObject(v) ? v.type : v;
				if (!MARKS.includes(type))
					errors.push(`unknown mark ${JSON.stringify(type)}; marks are ${MARKS.join(", ")}`);
			} else if (k === "data" && isObject(v)) {
				if (typeof v.name === "string" && !names.has(v.name))
					errors.push(
						`data name "${v.name}" isn't a table; the tables are ${[...names].join(", ") || "none"}`,
					);
				knowRows(v.values);
			} else if (k === "as") {
				for (const a of [v].flat()) if (typeof a === "string") known.add(a);
			} else if (k === "fold") {
				known.add("key");
				known.add("value");
			} else if (k === "encoding" && isObject(v)) {
				walk(v, (k2, v2) => {
					if (k2 === "field" && typeof v2 === "string") fields.add(v2);
				});
			}
		});
		for (const f of fields) {
			if (!known.has(f.split(".")[0]))
				warnings.push(
					`field "${f}" isn't a column of any table (columns: ${[...known].join(", ") || "none"})`,
				);
		}
	};
	// The Vega-Lite logger: warnings and errors go to the lists.
	const loggerFor = (errors, warnings) => ({
		level(l) {
			return l === undefined ? 2 : this;
		},
		error(...a) {
			errors.push(a.join(" "));
			return this;
		},
		warn(...a) {
			warnings.push(a.join(" "));
			return this;
		},
		info() {
			return this;
		},
		debug() {
			return this;
		},
	});
	// { ok, errors, warnings, vega } for spec text and tables; vega is the compiled Vega spec.
	const check = (text, tables) => {
		const errors = [];
		const warnings = [];
		const out = (vegaSpec = null) => ({
			ok: errors.length === 0,
			errors,
			warnings,
			vega: vegaSpec,
		});
		if (text.trim() === "") {
			errors.push("there is no spec yet: set one with set_spec");
			return out();
		}
		const { value: spec, error } = parseJson(text);
		if (error) errors.push(`the spec isn't valid JSON: ${error}`);
		else if (!isObject(spec)) errors.push("the spec must be a JSON object");
		if (errors.length > 0) return out();
		precheck(spec, tables, errors, warnings);
		if (errors.length > 0) return out();
		try {
			const compiled = compile(fullSpec(spec, tables), {
				logger: loggerFor(errors, warnings),
			}).spec;
			vega.parse(compiled);
			return out(compiled);
		} catch (e) {
			errors.push(`Vega-Lite can't compile the spec: ${e.message}`);
			return out();
		}
	};
	// Getters run on every render: the last report is kept per tables (state doesn't change in
	// place), with the spec text it is for.
	const reports = new WeakMap();
	const reportOf = (self) => {
		const last = reports.get(self.tables.items);
		if (last?.text === self.specText) return last.report;
		const report = check(self.specText, self.tables.items);
		reports.set(self.tables.items, { text: self.specText, report });
		return report;
	};

	// The spec's editor: a JsonView whose text is the spec's text.
	const specEditor = (text) => ({
		id: "spec",
		label: "Spec",
		text,
		mode: "tree",
		editable: true,
		on: "set_spec_text",
		rows: 16,
	});
	// The first edit of an empty lab makes its spec part.
	const claim = (self, next) => {
		if (self.specId === "") next.specId = "spec";
	};

	const VegaLiteLab = component({
		name: "VegaLiteLab",
		fields: {
			specId: t.string(), // The spec part's id; "" until there is one.
			specView: t.component("JsonView"), // Its text is the spec's text.
			tables: t.component("List"),
		},
		methods: {
			tableById(id) {
				return this.tables.items.find((x) => x.id === id);
			},
			toDomain() {
				const { value } = parseJson(this.specText);
				return {
					spec: value === undefined ? null : structuredClone(value),
					specText: this.specText,
					tables: this.tables.items.map(({ id, kind, rows }) => ({ id, kind, rows })),
				};
			},
		},
		queries: {
			get specText() {
				return this.specView?.text ?? "";
			},
			// view tool: whether the spec compiles, and why not.
			get compile_report() {
				const { ok, errors, warnings, vega: v } = reportOf(this);
				return {
					ok,
					errors,
					warnings,
					tables: this.tables.items.map((x) => x.id),
					marks: v === null ? [] : (v.marks ?? []).map((m) => m.type),
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
			// The spec as the chart element draws it: tables inlined as datasets.
			get chartSpec() {
				if (!reportOf(this).ok) return "";
				return JSON.stringify(fullSpec(parseJson(this.specText).value, this.tables.items));
			},
			get headline() {
				const { ok, errors, warnings } = reportOf(this);
				return ok ? `compiles · ${warnings.length} warnings` : `${errors.length} errors`;
			},
			get summary() {
				const { errors, warnings } = reportOf(this);
				return [
					`Vega-Lite spec ${this.specId || "(none yet)"}: ${this.headline}.`,
					`tables (${this.tables.items.length}):`,
					...this.tables.items.map(
						(x) =>
							`  ${x.id} (${x.label}): ${x.columns.map((c) => `${c.name}: ${c.type}`).join(", ")}`,
					),
					...errors.map((e) => `error: ${e}`),
					...warnings.map((w) => `warning: ${w}`),
					"spec:",
					clip(this.specText, 1500),
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("Vega-Lite lab"),
			$if(
				field("canRender"),
				tag["ma-vega-chart"]({ class: "block min-h-64 w-full", spec: field("chartSpec") }),
				p({ class: "text-sm opacity-60" }, "The chart shows once the spec compiles."),
			),
			messageList("errorList"),
			messageList("warningList", "text-warning"),
			render(field("specView")),
			section("Tables"),
			render(field("tables")),
		),
		on: {
			// The tables: drag to reorder (the order the chart's datasets are passed in), remove and
			// reorder_tables. Tables come from set_table, so the list has no add button.
			...listHandlers("tables"),
			set_spec: {
				pure: true,
				args: [t.any()],
				pre: (_self, [spec]) => isObject(spec),
				run(next, [spec]) {
					next.specView = apply(next.specView, "set_text", pretty(spec));
					claim(this, next);
				},
			},
			// The editor's edits: [its id, the text].
			set_spec_text: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [, text]) {
					next.specView = apply(next.specView, "set_text", text);
					claim(this, next);
				},
			},
			patch_spec: {
				pure: true,
				args: [t.string(), t.any()],
				pre: (self, [at, value]) => patchText(self.specText, at, setTo(value)) !== null,
				why: (self, [at, value]) => patchWhy(self.specText, at, setTo(value)),
				run(next, [at, value]) {
					next.specView = apply(
						next.specView,
						"set_text",
						patchText(this.specText, at, setTo(value)),
					);
				},
			},
			remove_spec_key: {
				pure: true,
				args: [t.string()],
				pre: (self, [at]) => patchText(self.specText, at, pointer.remove) !== null,
				why: (self, [at]) => patchWhy(self.specText, at, pointer.remove),
				run(next, [at]) {
					next.specView = apply(
						next.specView,
						"set_text",
						patchText(this.specText, at, pointer.remove),
					);
				},
			},
			set_table: {
				args: [t.string(), t.array(t.any())],
				pre: (_self, [id, rows]) => /^[\w-]+$/.test(id) && rows.every(isObject),
				run(next, [id, rows], ctx) {
					const i = this.tables.items.findIndex((x) => x.id === id);
					if (i < 0) {
						next.tables = apply(
							next.tables,
							"add_item",
							ctx.scope.make("DataTable", { id, kind: "table", rows, edited: true }),
						);
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
	// in the spec's terms (glimpse(arguments)), and whether the spec compiles, opening to the
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
						? `compiles · ${this.warningList.length} warnings`
						: `${this.errorList.length} errors`;
				},
				// Red when it failed or doesn't compile, amber when it compiles with warnings.
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
	// patch_spec: "/encoding/x/field = "a"".
	const PatchSpecCall = reportCall(
		"PatchSpecCall",
		({ pointer: at = "?", value }) => `${at} = ${preview(value, 60)}`,
	);
	// set_spec: its mark and the table it reads, "mark: bar · data: sales".
	const SetSpecCall = reportCall("SetSpecCall", ({ spec }) => {
		if (!isObject(spec)) return preview(spec, 60);
		const mark = isObject(spec.mark) ? spec.mark.type : spec.mark;
		const what = [
			...(mark === undefined ? [] : [`mark: ${mark}`]),
			...(isObject(spec.data) && typeof spec.data.name === "string"
				? [`data: ${spec.data.name}`]
				: []),
			...["layer", "concat", "hconcat", "vconcat"]
				.filter((k) => Array.isArray(spec[k]))
				.map((k) => `${k}: ${spec[k].length}`),
		];
		return what.join(" · ") || preview(spec, 60);
	});

	// Module tools: they get the root's toDomain().
	const tools = {
		describe_tables: async (domain) => ({ result: domain.tables.map(describe) }),
		// Renders the chart to SVG off screen, which runs the data flow, so runtime warnings show.
		render_svg: async (domain) => {
			const errors = [];
			const warnings = [];
			const { ok, vega: compiled } = check(domain.specText, domain.tables);
			if (!ok) return { result: { error: "the spec doesn't compile: see compile_report" } };
			const view = new vega.View(vega.parse(compiled), {
				renderer: "none",
				logger: loggerFor(errors, warnings),
			});
			try {
				const svg = await view.toSVG();
				const size = (k) => Number(svg.match(new RegExp(`${k}="([\\d.]+)"`))?.[1] ?? 0);
				return {
					result: {
						ok: errors.length === 0,
						width: size("width"),
						height: size("height"),
						svgBytes: svg.length,
						errors,
						warnings,
					},
				};
			} catch (e) {
				return { result: { error: `rendering failed: ${e.message}` } };
			} finally {
				view.finalize();
			}
		},
	};

	// The chart element: tutuca sets its spec attribute and it draws with vega-embed. Draws can
	// overlap, so only the latest one's result is kept.
	kit.ui.defineAttrElement("ma-vega-chart", "spec", {
		async draw(el, text) {
			if (text === "") return;
			el.n = (el.n ?? 0) + 1;
			const n = el.n;
			el.result?.finalize();
			el.result = null;
			el.replaceChildren();
			try {
				const result = await embed(el, JSON.parse(text), { actions: false });
				if (n === el.n) el.result = result;
				else result.finalize();
			} catch (e) {
				if (n === el.n) el.textContent = `The chart failed: ${e.message}`;
			}
		},
		dispose(el) {
			el.result?.finalize();
			el.result = null;
		},
	});

	// The root for msg: its first vega-lite part and its tables.
	const decode = (C, bindings, msg) => {
		const spec = (bindings.specs ?? kidsOf(msg, "vega-lite"))[0];
		return C.VegaLiteLab({
			specId: spec?.id ?? "",
			specView: C.JsonView(specEditor(spec === undefined ? "" : pretty(toJson(spec.data ?? null)))),
			tables: listOf(
				C,
				"tables",
				(bindings.tables ?? kidsOf(msg, KINDS)).map((m) => C.DataTable(readPart(m))),
			),
		});
	};

	// msg with root's spec and tables. Unchanged parts stay the same objects; a spec that
	// doesn't parse keeps the old one; tables that weren't edited stay, removed ones go, new
	// ones are added at the end (after a new spec) and the table parts follow the tables' order.
	const encode = (root, msg) => {
		const { value: spec } = parseJson(root.specText);
		const ok = isObject(spec);
		const withSpec = withPart(
			msg,
			"vega-lite",
			root.specId,
			(m) => (!ok || sameAsPart(m, root.specText) ? m : { ...m, data: fromJson(spec) }),
			() => (ok && root.specId !== "" ? message(root.specId, "vega-lite", fromJson(spec)) : null),
		);
		const tables = {
			items: root.tables.items,
			same: (_m, x) => !x.edited,
			update: writePart,
			create: (x) => writePart(null, x),
			ordered: true,
		};
		return encodeParts(withSpec, { table: tables, csv: tables });
	};

	return {
		components: { ...kit.ui.components, VegaLiteLab, PatchSpecCall, SetSpecCall },
		root: "VegaLiteLab",
		decode,
		encode,
		tools,
		toolViews: { patch_spec: "PatchSpecCall", set_spec: "SetSpecCall" },
	};
}
