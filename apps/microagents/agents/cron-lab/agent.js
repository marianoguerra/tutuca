// cron-lab: standard 5-field cron expressions (minute hour day month weekday), each parsed,
// described in English and run forward from a reference time to show its next runs. A cron part
// may say when to start counting (meta https://tutuca.dev/d/cron, header from: an ISO time) and
// which first run it expects (meta https://tutuca.dev/d/expect, header next: an ISO time).
// Everything is computed in UTC, so the same message always shows the same runs; the timezone
// is only displayed. The chip rows and the inputs notify the root's handlers, the same ones the
// model's tools send.
export default function define(kit) {
	const {
		$if,
		apply,
		button,
		component,
		each,
		field,
		render,
		send,
		sourceKey,
		t,
		tag,
		targetValue,
	} = kit.tutuca;
	const { message } = kit.tdata;
	const { details, div, input, li, p, span, summary, ul } = tag;
	const { MONTHS, DAYS, pad, parseIso } = kit.lib.time;
	const { encodeParts, nextId, strOf, withData } = kit.lib.parts;
	const { DIALECT: EXPECT, withHeader } = kit.lib.expect;
	const { labHeader, listHandlers, listOf } = kit.ui;
	const CRON = "https://tutuca.dev/d/cron";
	const DEFAULT_FROM = "2025-01-01T00:00:00Z";
	const MINUTE = 60000;

	const abbrev = (names) => names.map((n) => n.slice(0, 3).toUpperCase());
	// The five fields: their range, the names they accept and how a value reads in English.
	const FIELDS = [
		{ name: "minute", min: 0, max: 59, unit: "minute", label: String },
		{ name: "hour", min: 0, max: 23, unit: "hour", label: String },
		{ name: "day", min: 1, max: 31, unit: "day", label: String },
		{
			name: "month",
			min: 1,
			max: 12,
			unit: "month",
			names: abbrev(MONTHS),
			label: (v) => MONTHS[v - 1],
		},
		{
			name: "weekday",
			min: 0,
			max: 7,
			unit: "day of the week",
			names: abbrev(DAYS),
			label: (v) => DAYS[v % 7],
		},
	];
	const FIELD_NAMES = FIELDS.map((f) => f.name);
	const MACROS = {
		"@yearly": "0 0 1 1 *",
		"@annually": "0 0 1 1 *",
		"@monthly": "0 0 1 * *",
		"@weekly": "0 0 * * 0",
		"@daily": "0 0 * * *",
		"@midnight": "0 0 * * *",
		"@hourly": "0 * * * *",
	};

	const isoOf = (ms) => new Date(ms).toISOString().replace(":00.000Z", "Z");

	// One field's text as { values: Set, star, parts } or { error }. A part is { from, to, step,
	// all, single }; weekday 7 is Sunday, as 0 is.
	const parseField = (text, f) => {
		const atom = (s) => {
			const up = s.toUpperCase();
			const named = f.names?.indexOf(up) ?? -1;
			if (named >= 0) return named + (f.name === "month" ? 1 : 0);
			if (!/^\d+$/.test(s)) throw new Error(`"${s}" isn't a number${f.names ? " or a name" : ""}`);
			const n = Number(s);
			if (n < f.min || n > f.max) throw new Error(`${n} is out of range ${f.min}-${f.max}`);
			return n;
		};
		try {
			const values = new Set();
			const parts = text.split(",").map((item) => {
				const m = /^([^/]+)(?:\/(\d+))?$/.exec(item);
				if (m === null) throw new Error(`"${item}" isn't a value, range or step`);
				const step = m[2] === undefined ? 1 : Number(m[2]);
				if (step < 1) throw new Error(`the step in "${item}" must be at least 1`);
				let from;
				let to;
				const all = m[1] === "*";
				if (all) [from, to] = [f.min, f.name === "weekday" ? 6 : f.max];
				else {
					const ends = m[1].split("-");
					if (ends.length > 2) throw new Error(`"${m[1]}" isn't a range`);
					from = atom(ends[0]);
					to = ends.length === 2 ? atom(ends[1]) : m[2] === undefined ? from : f.max;
					if (to < from) throw new Error(`the range "${m[1]}" goes backwards`);
				}
				for (let v = from; v <= to; v += step) values.add(f.name === "weekday" ? v % 7 : v);
				return { from, to, step, all, single: !all && from === to };
			});
			return { values, star: text.startsWith("*"), parts };
		} catch (error) {
			return { error: error.message };
		}
	};

	// An expression as { fields: { minute: …, … }, texts: [5 strings] } or { error, field }.
	const parseCron = (expression) => {
		const trimmed = String(expression).trim();
		const lower = trimmed.toLowerCase();
		if (lower.startsWith("@")) {
			if (MACROS[lower] === undefined)
				return {
					error: `unknown macro ${trimmed} (use ${Object.keys(MACROS).join(", ")})`,
					field: "",
				};
			return parseCron(MACROS[lower]);
		}
		const texts = trimmed === "" ? [] : trimmed.split(/\s+/);
		if (texts.length !== 5)
			return {
				error: `expected 5 fields (minute hour day month weekday), got ${texts.length}`,
				field: "",
			};
		const fields = {};
		for (const [i, f] of FIELDS.entries()) {
			const parsed = parseField(texts[i], f);
			if (parsed.error !== undefined) return { error: `${f.name}: ${parsed.error}`, field: f.name };
			fields[f.name] = parsed;
		}
		return { fields, texts };
	};

	// Whether the day of d matches: with both day and weekday restricted, either one does.
	const dayMatches = ({ day, weekday }, d) => {
		const dom = day.values.has(d.getUTCDate());
		const dow = weekday.values.has(d.getUTCDay());
		return day.star || weekday.star ? dom && dow : dom || dow;
	};
	// The next count runs strictly after fromMs, as epoch ms (fewer when it never runs again
	// within 50 years).
	const nextRuns = (fields, fromMs, count) => {
		const out = [];
		let at = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE;
		const until = at + 50 * 366 * 24 * 60 * MINUTE;
		while (out.length < count && at < until) {
			const d = new Date(at);
			const [y, mo, day, h] = [
				d.getUTCFullYear(),
				d.getUTCMonth(),
				d.getUTCDate(),
				d.getUTCHours(),
			];
			if (!fields.month.values.has(mo + 1)) at = Date.UTC(y, mo + 1, 1);
			else if (!dayMatches(fields, d)) at = Date.UTC(y, mo, day + 1);
			else if (!fields.hour.values.has(h)) at = Date.UTC(y, mo, day, h + 1);
			else {
				if (fields.minute.values.has(d.getUTCMinutes())) out.push(at);
				at += MINUTE;
			}
		}
		return out;
	};

	const listText = (items) =>
		items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
	const plural = (f, n) => (n === 1 ? f.unit : `${n} ${f.unit.replace(/^(\w+)/, "$1s")}`);
	// One comma part of a field in English: "every 15 minutes", "Monday through Friday", "9".
	const partText = (f, p) => {
		if (p.all) return `every ${plural(f, p.step)}`;
		const range = p.single ? f.label(p.from) : `${f.label(p.from)} through ${f.label(p.to)}`;
		return p.step === 1 ? range : `every ${plural(f, p.step)} from ${range}`;
	};
	const fieldText = (f, parsed, one, many) => {
		const parts = parsed.parts.map((p) => partText(f, p));
		const steps = parsed.parts.every((p) => p.step > 1 || p.all);
		return steps ? listText(parts) : `${parsed.values.size === 1 ? one : many}${listText(parts)}`;
	};
	const isAll = (parsed) => parsed.parts.some((p) => p.all && p.step === 1);
	const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

	// The English for parsed fields: "At 09:30 on Monday through Friday".
	const describe = ({ minute, hour, day, month, weekday }) => {
		const [fm, fh, fd, fmo, fw] = FIELDS;
		const singles = (x) => x.parts.every((p) => p.single);
		let time;
		if (singles(minute) && singles(hour) && minute.values.size * hour.values.size <= 6) {
			const times = [...hour.values]
				.sort((a, b) => a - b)
				.flatMap((h) => [...minute.values].sort((a, b) => a - b).map((m) => `${pad(h)}:${pad(m)}`));
			time = `At ${listText(times)}`;
		} else {
			time = isAll(minute)
				? "Every minute"
				: capital(fieldText(fm, minute, "at minute ", "at minutes "));
			if (!isAll(hour)) time += `, ${fieldText(fh, hour, "during hour ", "during hours ")}`;
		}
		const days = [];
		if (!isAll(day)) days.push(`${fieldText(fd, day, "on day ", "on days ")} of the month`);
		if (!isAll(weekday)) days.push(fieldText(fw, weekday, "on ", "on "));
		let out = `${time}${days.length > 0 ? ` ${days.join(day.star || weekday.star ? ", " : " or ")}` : ""}`;
		if (!isAll(month)) out += ` ${fieldText(fmo, month, "in ", "in ")}`;
		return out;
	};

	// A field's values as compact text: "*", "*/15", "1-5,10".
	const serialize = (values, f) => {
		const top = f.name === "weekday" ? 6 : f.max;
		const xs = [...values].sort((a, b) => a - b);
		if (xs.length === 0 || xs.length === top - f.min + 1) return "*";
		const step = xs[1] - xs[0];
		const progression = xs.every((v, i) => v === f.min + i * step) && xs.at(-1) + step > top;
		if (xs.length > 1 && step > 1 && progression) return `*/${step}`;
		const out = [];
		for (let i = 0; i < xs.length; ) {
			let j = i;
			while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
			if (j - i >= 2) out.push(`${xs[i]}-${xs[j]}`);
			else for (let k = i; k <= j; k++) out.push(String(xs[k]));
			i = j + 1;
		}
		return out.join(",");
	};
	// expression with one field replaced; a macro is spelled out first.
	const withField = (expression, name, value) => {
		const lower = String(expression).trim().toLowerCase();
		const texts = (MACROS[lower] ?? String(expression)).trim().split(/\s+/);
		const five = FIELDS.map((_, i) => texts[i] ?? "*");
		five[FIELD_NAMES.indexOf(name)] = value.trim() === "" ? "*" : value.trim();
		return five.join(" ");
	};

	const CHIP = "btn btn-xs min-h-0 h-6 px-1 font-mono";
	// The chips of one field: every value it can take, the ones the expression picks lit.
	const chipsOf = (parsed, name) => {
		const f = FIELDS[FIELD_NAMES.indexOf(name)];
		const top = name === "weekday" ? 6 : f.max;
		const out = [];
		for (let v = f.min; v <= top; v++) {
			const on = parsed.fields?.[name].values.has(v) ?? false;
			const label = f.names ? f.names[name === "month" ? v - 1 : v] : pad(v);
			out.push({ label, cls: `${CHIP} ${on ? "btn-primary" : "btn-ghost opacity-60"}` });
		}
		return out;
	};

	const CronRow = component({
		name: "CronRow",
		fields: {
			id: t.string(),
			expression: t.string(),
			timezone: t.string(),
			from: t.string(), // The reference time, ISO; "" for the default.
			expectNext: t.string(), // The expected first run, ISO; "" for none.
		},
		methods: {
			runs(count = 5) {
				return this.hasError ? [] : nextRuns(this.parsed.fields, this.fromMs, count).map(isoOf);
			},
		},
		queries: {
			get parsed() {
				return parseCron(this.expression);
			},
			get error() {
				return this.parsed.error ?? "";
			},
			get hasError() {
				return this.error !== "";
			},
			get fromMs() {
				const ms = parseIso(this.from || DEFAULT_FROM);
				return Number.isNaN(ms) ? parseIso(DEFAULT_FROM) : ms;
			},
			get fromLabel() {
				return `next runs after ${isoOf(this.fromMs)} (computed in UTC${this.timezone !== "UTC" ? `, shown for ${this.timezone}` : ""})`;
			},
			get description() {
				return this.hasError ? "" : describe(this.parsed.fields);
			},
			get nextList() {
				return this.runs(5).map((text) => ({ text }));
			},
			// pass, fail or none: whether the first run is the expected one.
			get status() {
				if (this.expectNext === "") return "none";
				const first = this.hasError ? undefined : nextRuns(this.parsed.fields, this.fromMs, 1)[0];
				return first !== undefined && first === parseIso(this.expectNext) ? "pass" : "fail";
			},
			get statusCls() {
				return { pass: "badge badge-success", fail: "badge badge-error", none: "hidden" }[
					this.status
				];
			},
			get statusText() {
				return `${this.status}: expects ${this.expectNext}`;
			},
			get minuteChips() {
				return chipsOf(this.parsed, "minute");
			},
			get hourChips() {
				return chipsOf(this.parsed, "hour");
			},
			get dayChips() {
				return chipsOf(this.parsed, "day");
			},
			get monthChips() {
				return chipsOf(this.parsed, "month");
			},
			get weekdayChips() {
				return chipsOf(this.parsed, "weekday");
			},
		},
		view: div(
			{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-2" },
			div(
				{ class: "join w-full" },
				span(
					{ class: "join-item flex items-center bg-base-200 px-2 font-mono text-sm" },
					field("id"),
				),
				input({
					class: "input input-sm input-bordered join-item flex-1 font-mono",
					"aria-label": "Expression",
					value: field("expression"),
					"on:input": send("editExpression", targetValue()),
				}),
				input({
					class: "input input-sm input-bordered join-item w-40",
					"aria-label": "Timezone",
					value: field("timezone"),
					"on:input": send("editTimezone", targetValue()),
				}),
			),
			$if(
				field("hasError"),
				p({ class: "text-sm text-error" }, field("error")),
				p({ class: "text-sm font-semibold" }, field("description")),
			),
			span({ class: field("statusCls") }, field("statusText")),
			p({ class: "text-xs opacity-60" }, field("fromLabel")),
			ul({ class: "font-mono text-xs" }, each(field("nextList"), li({}, field("text")))),
			details(
				{ class: "text-xs" },
				summary({ class: "cursor-pointer opacity-70" }, "Builder"),
				...["minute", "hour", "day", "month", "weekday"].map((name) =>
					div(
						{ class: "flex flex-wrap items-center gap-0.5 py-1" },
						span({ class: "w-16 opacity-60" }, name),
						each(
							field(`${name}Chips`),
							button(
								{ class: field("cls"), "on:click": send("toggle", name, sourceKey()) },
								field("label"),
							),
						),
					),
				),
			),
		),
		on: {
			// What the root changes.
			set_expression: {
				pure: true,
				args: [t.string()],
				run(next, [expression]) {
					next.expression = expression;
				},
			},
			set_timezone: {
				pure: true,
				args: [t.string()],
				run(next, [timezone]) {
					next.timezone = timezone;
				},
			},
			set_expect_next: {
				pure: true,
				args: [t.string()],
				run(next, [iso]) {
					next.expectNext = iso;
				},
			},
			editExpression: {
				args: [t.string()],
				emits: { notify: ["set_expression"] },
				run(_next, [expression], ctx) {
					ctx.notify("set_expression", [this.id, expression]);
				},
			},
			editTimezone: {
				args: [t.string()],
				emits: { notify: ["set_timezone"] },
				run(_next, [timezone], ctx) {
					ctx.notify("set_timezone", [this.id, timezone]);
				},
			},
			// A chip: value i of the field turns on or off.
			toggle: {
				args: [t.enum(...FIELD_NAMES), t.number().int().min(0)],
				emits: { notify: ["set_field"] },
				run(_next, [name, i], ctx) {
					const f = FIELDS[FIELD_NAMES.indexOf(name)];
					const v = f.min + i;
					const values = new Set(this.parsed.fields?.[name].values ?? []);
					if (values.has(v)) values.delete(v);
					else values.add(v);
					ctx.notify("set_field", [this.id, name, serialize(values, f)]);
				},
			},
		},
	});

	// A new row for expression, with the next free id.
	const newCron = (self, ctx, expression) =>
		ctx.scope.make("CronRow", {
			id: nextId("c", self.crons.items),
			expression,
			timezone: "UTC",
			from: "",
			expectNext: "",
		});
	const indexOf = (self, id) => self.crons.items.findIndex((c) => c.id === id);
	// next with message name(...args) applied to the cron with id.
	const toCron = (self, next, id, name, ...args) => {
		const i = indexOf(self, id);
		next.crons.items[i] = apply(next.crons.items[i], name, ...args);
	};

	const CronLab = component({
		name: "CronLab",
		fields: { crons: t.component("List") },
		methods: {
			cronById(id) {
				return this.crons.items.find((c) => c.id === id);
			},
			// view tool: one expression's description, fields and next runs.

			// view tool: the next count runs.

			toDomain() {
				return {
					crons: this.crons.items.map(({ id, expression, timezone, from, expectNext }) => ({
						id,
						expression,
						timezone,
						from,
						expectNext,
					})),
				};
			},
		},
		queries: {
			explain(id) {
				const c = this.cronById(id);
				if (c === undefined) return { error: `no cron ${id}` };
				if (c.hasError)
					return { id, expression: c.expression, error: c.error, field: c.parsed.field };
				const { fields, texts } = c.parsed;
				return {
					id,
					expression: c.expression,
					timezone: c.timezone,
					description: c.description,
					fields: Object.fromEntries(
						FIELD_NAMES.map((n, i) => [
							n,
							{ text: texts[i], values: [...fields[n].values].sort((a, b) => a - b) },
						]),
					),
					from: isoOf(c.fromMs),
					next: c.runs(5),
					expectNext: c.expectNext || null,
					status: c.status,
				};
			},
			next_runs(id, count = 5) {
				const c = this.cronById(id);
				if (c === undefined) return { error: `no cron ${id}` };
				if (c.hasError) return { error: c.error };
				const n = Math.max(1, Math.min(100, Math.floor(Number(count) || 5)));
				return { id, from: isoOf(c.fromMs), runs: c.runs(n) };
			},

			get counts() {
				const of = (s) => this.crons.items.filter((c) => c.status === s).length;
				return {
					invalid: this.crons.items.filter((c) => c.hasError).length,
					pass: of("pass"),
					fail: of("fail"),
				};
			},
			get headline() {
				const c = this.counts;
				return `${this.crons.items.length} expressions · ${c.invalid} invalid · ${c.pass} pass · ${c.fail} fail`;
			},
			get summary() {
				const c = this.counts;
				return [
					`${this.crons.items.length} cron expressions: ${c.invalid} invalid, ${c.pass} expectations pass, ${c.fail} fail.`,
					...this.crons.items.map(
						(x) =>
							`  ${x.id}: ${JSON.stringify(x.expression)} (${x.timezone}) ${x.hasError ? `error: ${x.error}` : `"${x.description}", next ${x.runs(1)[0] ?? "never"}`}${x.expectNext ? `, expects next ${x.expectNext}: ${x.status}` : ""}`,
					),
				].join("\n");
			},
		},
		view: div({ class: "flex flex-col gap-3" }, labHeader("Cron lab"), render(field("crons"))),
		on: {
			// The list: drag to reorder, remove, add (* * * * *) and reorder_crons.
			...listHandlers("crons", { make: (self, ctx) => newCron(self, ctx, "* * * * *") }),
			set_expression: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.cronById(id) !== undefined,
				run(next, [id, expression]) {
					toCron(this, next, id, "set_expression", expression);
				},
			},
			set_field: {
				pure: true,
				args: [t.string(), t.enum(...FIELD_NAMES), t.string()],
				pre: (self, [id]) => self.cronById(id) !== undefined,
				run(next, [id, name, value]) {
					const expression = withField(this.cronById(id).expression, name, value);
					toCron(this, next, id, "set_expression", expression);
				},
			},
			set_timezone: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.cronById(id) !== undefined,
				run(next, [id, timezone]) {
					toCron(this, next, id, "set_timezone", timezone);
				},
			},
			set_expected_next: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id, iso]) =>
					self.cronById(id) !== undefined && (iso === "" || !Number.isNaN(parseIso(iso))),
				run(next, [id, iso]) {
					toCron(this, next, id, "set_expect_next", iso);
				},
			},
			add_cron: {
				args: [t.string()],
				run(next, [expression], ctx) {
					next.crons = apply(next.crons, "add_item", newCron(this, ctx, expression));
				},
			},
			remove_cron: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.cronById(id) !== undefined,
				run(next, [id]) {
					next.crons = apply(next.crons, "remove_item_at", indexOf(this, id));
				},
			},
		},
	});

	const cronData = (m) =>
		typeof m.data === "string"
			? { expression: m.data, timezone: "UTC" }
			: { expression: strOf(m, "expression"), timezone: strOf(m, "timezone", "UTC") };
	const headerOf = (m, dialect, key) => {
		const v = m.meta?.get(dialect)?.get(key);
		return typeof v === "string" ? v : "";
	};

	// The root for msg: its cron parts (the query's binding, or the parts of that kind).
	const decode = (C, bindings, msg) =>
		C.CronLab({
			crons: listOf(
				C,
				"crons",
				(bindings.crons ?? kit.lib.parts.kidsOf(msg, "cron")).map((m) =>
					C.CronRow({
						id: m.id,
						...cronData(m),
						from: headerOf(m, CRON, "from"),
						expectNext: headerOf(m, EXPECT, "next"),
					}),
				),
				{ addLabel: "Expression" },
			),
		});

	// The data of cron c, written over m's (the timezone only when it isn't UTC or was there).
	const cronValues = (m, c) => ({
		expression: c.expression,
		timezone: c.timezone !== "UTC" || m?.data?.has?.("timezone") ? c.timezone : undefined,
	});
	// msg with root's crons: untouched parts stay the same objects, removed ones go, new ones go
	// at the end, the cron parts follow the crons' order and parts of other kinds stay where they
	// are.
	const encode = (root, msg) =>
		encodeParts(msg, {
			cron: {
				items: root.crons.items,
				ordered: true,
				same: (m, c) => {
					const old = cronData(m);
					return (
						old.expression === c.expression &&
						old.timezone === c.timezone &&
						headerOf(m, CRON, "from") === c.from &&
						headerOf(m, EXPECT, "next") === c.expectNext
					);
				},
				update: (m, c) => {
					const old = cronData(m);
					const sameData = old.expression === c.expression && old.timezone === c.timezone;
					let meta = m.meta;
					if (headerOf(m, CRON, "from") !== c.from) meta = withHeader(meta, CRON, "from", c.from);
					if (headerOf(m, EXPECT, "next") !== c.expectNext)
						meta = withHeader(meta, EXPECT, "next", c.expectNext);
					return { ...m, data: sameData ? m.data : withData(m, cronValues(m, c)).data, meta };
				},
				create: (c) => {
					const meta = withHeader(
						withHeader(new Map(), CRON, "from", c.from),
						EXPECT,
						"next",
						c.expectNext,
					);
					return message(c.id, "cron", withData({}, cronValues(null, c)).data, meta);
				},
			},
		});

	// How the chat shows a set_expression call: the expression, what it means in English and its
	// next run (from the summary it answers with), or why it doesn't parse.
	const SetExpressionCall = component({
		name: "SetExpressionCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get args() {
				return this.call?.arguments ?? {};
			},
			get expression() {
				const { id = "?", expression = "" } = this.args;
				return `${id} = ${expression}`;
			},
			get parsed() {
				return parseCron(this.args.expression ?? "");
			},
			get meaning() {
				return this.parsed.error ?? describe(this.parsed.fields);
			},
			get glimpse() {
				return `${this.expression} · ${this.meaning}`;
			},
			// The next run, from the expression's line in the summary.
			get next() {
				const line = this.resultText.split("\n").find((l) => l.startsWith(`  ${this.args.id}: `));
				return /, next (\S+?)(,|$)/.exec(line ?? "")?.[1] ?? "";
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				if (this.parsed.error !== undefined) return "invalid";
				return this.next === "" ? "ok" : `next ${this.next}`;
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, this.parsed.error !== undefined);
			},
		}),
		view: kit.ui.toolCallFrame("glimpse", p(field("meaning"))),
	});

	return {
		components: { ...kit.ui.components, CronRow, CronLab, SetExpressionCall },
		root: "CronLab",
		decode,
		encode,
		toolViews: { set_expression: "SetExpressionCall" },
	};
}
