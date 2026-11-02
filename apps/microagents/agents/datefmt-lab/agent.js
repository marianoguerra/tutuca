// datefmt-lab: instants formatted by strftime patterns and by Intl.DateTimeFormat settings, in a
// table of instant × format. A format part may say, per instant id, which output it expects
// (meta https://tutuca.dev/d/expect, header <instant id>: the text). strftime is implemented here
// and runs in UTC; Intl formats in UTC unless the options name a timeZone, and with "en-US" when
// the locale is empty, so the output never depends on the machine. The rows' inputs notify the
// root's handlers, the same ones the model's tools send.
export default function define(kit) {
	const { $if, apply, component, each, field, render, send, sourceKey, t, tag, targetValue } =
		kit.tutuca;
	const { Instant, message } = kit.tdata;
	const { div, input, option, p, select, span } = tag;
	const { MONTHS, DAYS, pad, parseIso } = kit.lib.time;
	const { encodeParts, kidsOf, nextId, strOf } = kit.lib.parts;
	const expects = kit.lib.expect;
	const { gridView, labHeader, listHandlers, listOf, section } = kit.ui;
	const DEFAULT_LOCALE = "en-US";
	const DAY_MS = 86400000;

	const nsToMs = (ns) => {
		const n = BigInt(ns);
		const q = n / 1000000n;
		return Number(n < 0n && q * 1000000n !== n ? q - 1n : q);
	};

	const yday = (d) => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS); // 0-based
	// The ISO 8601 week-numbering year and week of d.
	const isoWeek = (d) => {
		const thursday = new Date(+d + (3 - ((d.getUTCDay() + 6) % 7)) * DAY_MS);
		const year = thursday.getUTCFullYear();
		return { year, week: 1 + Math.floor(yday(thursday) / 7) };
	};
	const hour12 = (d) => d.getUTCHours() % 12 || 12;

	// The directives: letter → [what it gives, (date) → text]. Every one reads the UTC fields.
	const D = {
		a: ["abbreviated weekday (Mon)", (d) => DAYS[d.getUTCDay()].slice(0, 3)],
		A: ["full weekday (Monday)", (d) => DAYS[d.getUTCDay()]],
		b: ["abbreviated month (Jan)", (d) => MONTHS[d.getUTCMonth()].slice(0, 3)],
		h: ["same as %b", (d) => MONTHS[d.getUTCMonth()].slice(0, 3)],
		B: ["full month (January)", (d) => MONTHS[d.getUTCMonth()]],
		c: [
			"date and time (Tue Mar  5 14:07:09 2024)",
			(d) => strftime("%a %b %e %H:%M:%S %Y", +d).text,
		],
		C: ["century, 2 digits", (d) => pad(Math.floor(d.getUTCFullYear() / 100))],
		d: ["day of the month, 01-31", (d) => pad(d.getUTCDate())],
		D: ["%m/%d/%y", (d) => strftime("%m/%d/%y", +d).text],
		e: ["day of the month, space-padded ( 5)", (d) => pad(d.getUTCDate(), 2, " ")],
		F: ["%Y-%m-%d", (d) => strftime("%Y-%m-%d", +d).text],
		g: ["ISO week-numbering year, 2 digits", (d) => pad(isoWeek(d).year % 100)],
		G: ["ISO week-numbering year", (d) => String(isoWeek(d).year)],
		H: ["hour, 00-23", (d) => pad(d.getUTCHours())],
		I: ["hour, 01-12", (d) => pad(hour12(d))],
		j: ["day of the year, 001-366", (d) => pad(yday(d) + 1, 3)],
		k: ["hour, space-padded ( 0-23)", (d) => pad(d.getUTCHours(), 2, " ")],
		l: ["hour, space-padded ( 1-12)", (d) => pad(hour12(d), 2, " ")],
		L: ["milliseconds, 000-999", (d) => pad(d.getUTCMilliseconds(), 3)],
		m: ["month, 01-12", (d) => pad(d.getUTCMonth() + 1)],
		M: ["minute, 00-59", (d) => pad(d.getUTCMinutes())],
		n: ["a newline", () => "\n"],
		p: ["AM or PM", (d) => (d.getUTCHours() < 12 ? "AM" : "PM")],
		P: ["am or pm", (d) => (d.getUTCHours() < 12 ? "am" : "pm")],
		r: ["%I:%M:%S %p", (d) => strftime("%I:%M:%S %p", +d).text],
		R: ["%H:%M", (d) => strftime("%H:%M", +d).text],
		s: ["seconds since the epoch", (d) => String(Math.floor(+d / 1000))],
		S: ["second, 00-60", (d) => pad(d.getUTCSeconds())],
		t: ["a tab", () => "\t"],
		T: ["%H:%M:%S", (d) => strftime("%H:%M:%S", +d).text],
		u: ["weekday, 1-7 (Monday is 1)", (d) => String(d.getUTCDay() || 7)],
		U: [
			"week of the year, Sunday first, 00-53",
			(d) => pad(Math.floor((yday(d) + 7 - d.getUTCDay()) / 7)),
		],
		V: ["ISO week, 01-53", (d) => pad(isoWeek(d).week)],
		w: ["weekday, 0-6 (Sunday is 0)", (d) => String(d.getUTCDay())],
		W: [
			"week of the year, Monday first, 00-53",
			(d) => pad(Math.floor((yday(d) + 7 - ((d.getUTCDay() + 6) % 7)) / 7)),
		],
		x: ["%m/%d/%y", (d) => strftime("%m/%d/%y", +d).text],
		X: ["%H:%M:%S", (d) => strftime("%H:%M:%S", +d).text],
		y: ["year, 2 digits", (d) => pad(d.getUTCFullYear() % 100)],
		Y: ["year", (d) => String(d.getUTCFullYear())],
		z: ["offset from UTC (+0000)", () => "+0000"],
		Z: ["timezone name (UTC)", () => "UTC"],
		"%": ["a literal %", () => "%"],
	};
	// fmt applied to the instant at ms, in UTC: { text, errors }. %-x drops x's padding; an
	// unknown directive is written as [%x?] and reported.
	function strftime(fmt, ms) {
		const d = new Date(ms);
		const errors = [];
		let text = "";
		for (let i = 0; i < fmt.length; i++) {
			if (fmt[i] !== "%") {
				text += fmt[i];
				continue;
			}
			const noPad = fmt[i + 1] === "-";
			const at = i;
			i += noPad ? 2 : 1;
			const c = fmt[i];
			if (c === undefined) {
				errors.push(`a lone % at the end (position ${at})`);
				text += "[%?]";
			} else if (D[c] === undefined) {
				errors.push(`unknown directive %${c} at position ${at}`);
				text += `[%${c}?]`;
			} else {
				const out = D[c][1](d);
				text += noPad ? out.replace(/^[0 ]+(?=.)/, "") : out;
			}
		}
		return { text, errors };
	}

	// The Intl options a select offers; timeZone also takes any IANA name through the tools.
	const STYLES = ["full", "long", "medium", "short"];
	const TEXTS = ["long", "short", "narrow"];
	const DIGITS = ["numeric", "2-digit"];
	const CHOICES = {
		dateStyle: STYLES,
		timeStyle: STYLES,
		weekday: TEXTS,
		era: TEXTS,
		year: DIGITS,
		month: [...DIGITS, ...TEXTS],
		day: DIGITS,
		hour: DIGITS,
		minute: DIGITS,
		second: DIGITS,
		hour12: ["true", "false"],
		timeZone: [
			"UTC",
			"America/New_York",
			"America/Los_Angeles",
			"America/Argentina/Buenos_Aires",
			"Europe/London",
			"Europe/Berlin",
			"Asia/Kolkata",
			"Asia/Tokyo",
			"Australia/Sydney",
		],
		timeZoneName: ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"],
	};
	const OPTION_NAMES = Object.keys(CHOICES);
	// The options as Intl takes them: hour12 a boolean, UTC unless a timeZone is given.
	const intlOptions = (options) => {
		const out = { timeZone: "UTC" };
		for (const [k, v] of Object.entries(options)) out[k] = k === "hour12" ? v === "true" : v;
		return out;
	};
	const formatter = (locale, options) => {
		try {
			return {
				fmt: new Intl.DateTimeFormat(locale || DEFAULT_LOCALE, intlOptions(options)),
				error: "",
			};
		} catch (error) {
			return { fmt: null, error: error.message };
		}
	};

	const InstantRow = component({
		name: "InstantRow",
		fields: { id: t.string(), value: t.string(), form: t.enum("inst", "iso") },
		queries: {
			get ms() {
				return this.form === "inst" ? nsToMs(this.value) : parseIso(this.value);
			},
			get valid() {
				return !Number.isNaN(this.ms) && Math.abs(this.ms) <= 8.64e15;
			},
			get iso() {
				return this.valid ? new Date(this.ms).toISOString() : this.value;
			},
			get error() {
				return this.valid ? "" : `"${this.value}" isn't an ISO time`;
			},
			// What the input shows: the text as typed, or an Instant as ISO.
			get text() {
				return this.form === "iso" ? this.value : this.iso;
			},
		},
		view: div(
			{ class: "join w-full" },
			span(
				{ class: "join-item flex items-center bg-base-200 px-2 font-mono text-sm" },
				field("id"),
			),
			input({
				class: "input input-sm input-bordered join-item flex-1 font-mono",
				"aria-label": "Instant",
				value: field("text"),
				"on:input": send("edit", targetValue()),
			}),
		),
		on: {
			// What the root changes.
			set_value: {
				pure: true,
				args: [t.string(), t.enum("inst", "iso")],
				run(next, [value, form]) {
					next.value = value;
					next.form = form;
				},
			},
			edit: {
				args: [t.string()],
				emits: { notify: ["set_instant"] },
				run(_next, [iso], ctx) {
					ctx.notify("set_instant", [this.id, iso]);
				},
			},
		},
	});

	const StrftimeRow = component({
		name: "StrftimeRow",
		fields: { id: t.string(), format: t.string(), expect: t.map(t.string()) },
		methods: {
			render(ms) {
				return strftime(this.format, ms);
			},
		},
		queries: {
			get error() {
				return strftime(this.format, 0).errors.join("; ");
			},
			get hasError() {
				return this.error !== "";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1" },
			div(
				{ class: "join w-full" },
				span(
					{ class: "join-item flex items-center bg-base-200 px-2 font-mono text-sm" },
					field("id"),
				),
				span({ class: "join-item flex items-center bg-base-200 px-2 text-xs" }, "strftime"),
				input({
					class: "input input-sm input-bordered join-item flex-1 font-mono",
					"aria-label": "strftime format",
					value: field("format"),
					"on:input": send("edit", targetValue()),
				}),
			),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		),
		on: {
			// What the root changes.
			set_format: {
				pure: true,
				args: [t.string()],
				run(next, [format]) {
					next.format = format;
				},
			},
			// The output it should give for an instant, or none.
			set_expect: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [instantId, expected]) {
					next.expect[instantId] = expected;
				},
			},
			clear_expect: {
				pure: true,
				args: [t.string()],
				run(next, [instantId]) {
					delete next.expect[instantId];
				},
			},
			edit: {
				args: [t.string()],
				emits: { notify: ["set_strftime"] },
				run(_next, [format], ctx) {
					ctx.notify("set_strftime", [this.id, format]);
				},
			},
		},
	});

	const IntlRow = component({
		name: "IntlRow",
		fields: {
			id: t.string(),
			locale: t.string(),
			options: t.map(t.string()),
			expect: t.map(t.string()),
		},
		methods: {
			render(ms) {
				const { fmt, error } = this.made;
				if (fmt === null) return { text: "", errors: [error] };
				try {
					return { text: fmt.format(ms), errors: [] };
				} catch (e) {
					return { text: "", errors: [e.message] };
				}
			},
			parts(ms) {
				return this.made.fmt?.formatToParts(ms) ?? [];
			},
		},
		queries: {
			get made() {
				return formatter(this.locale, this.options);
			},
			get error() {
				return this.made.error;
			},
			get hasError() {
				return this.error !== "";
			},
			get resolved() {
				return this.made.fmt?.resolvedOptions() ?? {};
			},
			get resolvedChips() {
				return Object.entries(this.resolved).map(([k, v]) => ({ text: `${k}: ${v}` }));
			},
			// One select per option: its choices, "" (not set) first, the current value kept.
			get optionRows() {
				return OPTION_NAMES.map((name) => {
					const value = this.options[name] ?? "";
					const values = ["", ...CHOICES[name]];
					if (!values.includes(value)) values.push(value);
					return { name, value, choices: values.map((v) => ({ value: v, label: v || "—" })) };
				});
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
				span({ class: "join-item flex items-center bg-base-200 px-2 text-xs" }, "Intl locale"),
				input({
					class: "input input-sm input-bordered join-item flex-1 font-mono",
					"aria-label": "Locale",
					value: field("locale"),
					"on:input": send("editLocale", targetValue()),
				}),
			),
			div(
				{ class: "flex flex-wrap gap-2" },
				each(
					field("optionRows"),
					div(
						{ class: "flex flex-col text-xs" },
						span({ class: "opacity-60" }, field("name")),
						select(
							{
								class: "select select-xs select-bordered",
								value: field("value"),
								"on:change": send("pick", sourceKey(), targetValue()),
							},
							each(field("choices"), option({ value: field("value") }, field("label"))),
						),
					),
				),
			),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
			div(
				{ class: "flex flex-wrap gap-1" },
				each(
					field("resolvedChips"),
					span({ class: "badge badge-ghost badge-sm font-mono" }, field("text")),
				),
			),
		),
		on: {
			// What the root changes.
			set_locale: {
				pure: true,
				args: [t.string()],
				run(next, [locale]) {
					next.locale = locale;
				},
			},
			// "" removes the option.
			set_option: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [name, value]) {
					if (value === "") delete next.options[name];
					else next.options[name] = value;
				},
			},
			// The output it should give for an instant, or none.
			set_expect: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [instantId, expected]) {
					next.expect[instantId] = expected;
				},
			},
			clear_expect: {
				pure: true,
				args: [t.string()],
				run(next, [instantId]) {
					delete next.expect[instantId];
				},
			},
			editLocale: {
				args: [t.string()],
				emits: { notify: ["set_locale"] },
				run(_next, [locale], ctx) {
					ctx.notify("set_locale", [this.id, locale]);
				},
			},
			pick: {
				args: [t.number().int().min(0), t.string()],
				emits: { notify: ["set_intl_option"] },
				run(_next, [i, value], ctx) {
					ctx.notify("set_intl_option", [this.id, OPTION_NAMES[i], value]);
				},
			},
		},
	});

	const CELL = {
		pass: "badge badge-success h-auto whitespace-pre-wrap font-mono",
		fail: "badge badge-error h-auto whitespace-pre-wrap font-mono",
		none: "badge badge-ghost h-auto whitespace-pre-wrap font-mono",
		error: "badge badge-warning h-auto whitespace-pre-wrap font-mono",
	};
	const at = (list, id) => list.findIndex((x) => x.id === id);
	// New rows, with the next free id (instants i1, i2, …; formats f1, f2, … across both kinds).
	const newInstant = (self, ctx, iso) =>
		ctx.scope.make("InstantRow", { id: nextId("i", self.instants.items), value: iso, form: "iso" });
	const newStrftime = (self, ctx, format) =>
		ctx.scope.make("StrftimeRow", { id: nextId("f", self.formats), format, expect: {} });
	const newIntl = (self, ctx, locale) =>
		ctx.scope.make("IntlRow", {
			id: nextId("f", self.formats),
			locale,
			options: { dateStyle: "medium" },
			expect: {},
		});
	// next with message name(...args) applied to the format with id (a strftime or an Intl one).
	const toFormat = (self, next, id, name, ...args) => {
		const s = at(self.strftimes.items, id);
		const [list, i] = s >= 0 ? ["strftimes", s] : ["intls", at(self.intls.items, id)];
		next[list].items[i] = apply(next[list].items[i], name, ...args);
	};
	// After an instant goes: the formats' expectations for it go too.
	const forgetInstant = (self, next, instant) => {
		for (const f of self.formats)
			if (f.expect[instant.id] !== undefined)
				toFormat(self, next, f.id, "clear_expect", instant.id);
	};

	const DatefmtLab = component({
		name: "DatefmtLab",
		fields: {
			instants: t.component("List"),
			strftimes: t.component("List"),
			intls: t.component("List"),
		},
		methods: {
			instantById(id) {
				return this.instants.items.find((x) => x.id === id);
			},
			formatById(id) {
				return this.formats.find((x) => x.id === id);
			},
			// One cell: { output, expected, status: pass | fail | none | error, error }.
			cell(instant, format) {
				const expected = format.expect[instant.id] ?? null;
				if (!instant.valid) return { output: "", expected, status: "error", error: instant.error };
				const { text, errors } = format.render(instant.ms);
				const status =
					errors.length > 0
						? "error"
						: expected === null
							? "none"
							: expected === text
								? "pass"
								: "fail";
				return { output: text, expected, status, error: errors.join("; ") };
			},
			// view tool: a strftime pattern tried on every instant, without saving it.

			toDomain() {
				return {
					instants: this.instants.items.map(({ id, iso }) => ({ id, iso })),
					strftimes: this.strftimes.items.map(({ id, format, expect }) => ({
						id,
						format,
						expect: { ...expect },
					})),
					intls: this.intls.items.map(({ id, locale, options, expect }) => ({
						id,
						locale,
						options: { ...options },
						expect: { ...expect },
					})),
				};
			},
		},
		queries: {
			try_strftime(format) {
				return this.instants.items.map((i) => ({
					instant: i.id,
					...(i.valid ? strftime(String(format), i.ms) : { text: "", errors: [i.error] }),
				}));
			},

			get formats() {
				return [...this.strftimes.items, ...this.intls.items];
			},
			// view tool: every instant × format.
			get formatted() {
				return this.instants.items.map((i) => ({
					instant: i.id,
					iso: i.iso,
					cells: this.formats.map((f) => ({ format: f.id, ...this.cell(i, f) })),
				}));
			},
			// view tool: the strftime directives.
			get directives() {
				return Object.fromEntries(Object.entries(D).map(([c, [what]]) => [`%${c}`, what]));
			},
			// The table as a status grid (kit.lib.grid): instants down, formats across.
			get grid() {
				return kit.lib.grid.grid({
					rows: this.instants.items,
					cols: this.formats,
					corner: "instant",
					rowLabel: (i) => i.iso,
					colLabel: (f) => f.id,
					columns: "max-content",
					classes: CELL,
					cell: (i, f) => {
						const c = this.cell(i, f);
						return {
							status: c.status,
							label: c.output || "error",
							title: c.error || `expected: ${c.expected ?? "nothing"}; click to pin or clear`,
						};
					},
				});
			},
			get gridCells() {
				return this.grid.cells;
			},
			get gridStyle() {
				return this.grid.gridStyle;
			},
			// The parts of the first instant per Intl format, as chips.
			get partRows() {
				const first = this.instants.items.find((i) => i.valid);
				if (first === undefined) return [];
				return this.intls.items.map((f) => ({
					id: f.id,
					parts: f.parts(first.ms).map((x) => ({ text: x.value, title: x.type, label: x.type })),
				}));
			},
			get counts() {
				const cells = this.formatted.flatMap((r) => r.cells);
				const of = (s) => cells.filter((c) => c.status === s).length;
				return { pass: of("pass"), fail: of("fail"), none: of("none"), error: of("error") };
			},
			get headline() {
				const statuses = this.formatted.flatMap((r) => r.cells.map((c) => c.status));
				return expects.headline(statuses, { always: true, invalid: "error" });
			},
			get summary() {
				const c = this.counts;
				const expects = (f) =>
					Object.keys(f.expect).length ? ` expects ${JSON.stringify(f.expect)}` : "";
				return [
					`${this.instants.items.length} instants, ${this.strftimes.items.length} strftime formats, ${this.intls.items.length} Intl formats: ${c.pass} expectations pass, ${c.fail} fail, ${c.error} cells error.`,
					"instants:",
					...this.instants.items.map((i) => `  ${i.id}: ${i.iso}${i.valid ? "" : " (invalid)"}`),
					"formats:",
					...this.strftimes.items.map(
						(f) => `  ${f.id}: strftime ${JSON.stringify(f.format)}${expects(f)}`,
					),
					...this.intls.items.map(
						(f) =>
							`  ${f.id}: Intl ${f.locale || DEFAULT_LOCALE} ${JSON.stringify(f.options)}${expects(f)}`,
					),
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-3" },
			labHeader("Date format lab"),
			section("Instants"),
			render(field("instants")),
			section("Formats"),
			render(field("strftimes")),
			render(field("intls")),
			section("Output"),
			p(
				{ class: "text-xs opacity-60" },
				"Click a cell to pin its output as expected, or to clear it.",
			),
			div({ class: "overflow-x-auto" }, gridView("grid", "pin_cell")),
			section("Intl parts of the first instant"),
			each(
				field("partRows"),
				div(
					{ class: "flex flex-wrap items-center gap-1" },
					span({ class: "font-mono text-xs opacity-60" }, field("id")),
					each(
						field("parts"),
						span(
							{ class: "badge badge-outline h-auto gap-1 font-mono", title: field("title") },
							field("text"),
							span({ class: "text-[10px] opacity-50" }, field("label")),
						),
					),
				),
			),
		),
		on: {
			// The lists: drag to reorder, remove, add and reorder_<list>. Formats show strftimes first,
			// then Intl ones, so each kind is its own list.
			...listHandlers("instants", {
				make: (self, ctx) => newInstant(self, ctx, "2024-01-01T00:00:00Z"),
				removed: forgetInstant,
			}),
			...listHandlers("strftimes", {
				make: (self, ctx) => newStrftime(self, ctx, "%Y-%m-%d %H:%M:%S"),
			}),
			...listHandlers("intls", { make: (self, ctx) => newIntl(self, ctx, DEFAULT_LOCALE) }),
			add_instant: {
				args: [t.string()],
				pre: (_self, [iso]) => !Number.isNaN(parseIso(iso)),
				run(next, [iso], ctx) {
					next.instants = apply(next.instants, "add_item", newInstant(this, ctx, iso));
				},
			},
			// An instant read from an ISO text; one stored as a tdata Instant stays one when it parses.
			set_instant: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.instantById(id) !== undefined,
				run(next, [id, iso]) {
					const i = at(this.instants.items, id);
					const ms = parseIso(iso);
					const [value, form] =
						this.instants.items[i].form === "inst" && !Number.isNaN(ms)
							? [String(BigInt(ms) * 1000000n), "inst"]
							: [iso, "iso"];
					next.instants.items[i] = apply(next.instants.items[i], "set_value", value, form);
				},
			},
			remove_instant: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.instantById(id) !== undefined,
				run(next, [id]) {
					next.instants = apply(next.instants, "remove_item_at", at(this.instants.items, id));
					forgetInstant(this, next, this.instantById(id));
				},
			},
			add_strftime: {
				args: [t.string()],
				run(next, [format], ctx) {
					next.strftimes = apply(next.strftimes, "add_item", newStrftime(this, ctx, format));
				},
			},
			set_strftime: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => at(self.strftimes.items, id) >= 0,
				run(next, [id, format]) {
					toFormat(this, next, id, "set_format", format);
				},
			},
			add_intl: {
				args: [t.string()],
				run(next, [locale], ctx) {
					next.intls = apply(next.intls, "add_item", newIntl(this, ctx, locale));
				},
			},
			set_locale: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => at(self.intls.items, id) >= 0,
				run(next, [id, locale]) {
					toFormat(this, next, id, "set_locale", locale);
				},
			},
			// "" removes the option; options other than timeZone take one of their choices.
			set_intl_option: {
				pure: true,
				args: [t.string(), t.enum(...OPTION_NAMES), t.string()],
				pre: (self, [id, name, value]) =>
					at(self.intls.items, id) >= 0 &&
					(value === "" || name === "timeZone" || CHOICES[name].includes(value)),
				run(next, [id, name, value]) {
					toFormat(this, next, id, "set_option", name, value);
				},
			},
			remove_format: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.formatById(id) !== undefined,
				run(next, [id]) {
					const s = at(this.strftimes.items, id);
					if (s >= 0) next.strftimes = apply(next.strftimes, "remove_item_at", s);
					else next.intls = apply(next.intls, "remove_item_at", at(this.intls.items, id));
				},
			},
			// The output a format should give for an instant; "" clears it.
			set_expectation: {
				pure: true,
				args: [t.string(), t.string(), t.string()],
				pre: (self, [formatId, instantId]) =>
					self.formatById(formatId) !== undefined && self.instantById(instantId) !== undefined,
				run(next, [formatId, instantId, expected]) {
					if (expected === "") toFormat(this, next, formatId, "clear_expect", instantId);
					else toFormat(this, next, formatId, "set_expect", instantId, expected);
				},
			},
			// From the table: the cell at index i pins its output as expected, or clears it.
			pin_cell: {
				pure: true,
				args: [t.number().int().min(0)],
				run(next, [i]) {
					const place = this.grid.at(i);
					if (place === null) return;
					const instant = this.instants.items[place.row];
					const format = this.formats[place.col];
					const label = this.grid.cells[i].label;
					if (format.expect[instant.id] !== undefined)
						toFormat(this, next, format.id, "clear_expect", instant.id);
					else if (label !== "error")
						toFormat(this, next, format.id, "set_expect", instant.id, label);
				},
			},
		},
	});

	// Reading parts back: plain values, so a decoded part and the row compare as text.
	const instantOf = (m) =>
		m.data instanceof Instant
			? { value: String(m.data.epochNanoseconds), form: "inst" }
			: { value: typeof m.data === "string" ? m.data : "", form: "iso" };
	const expectOf = (m) => expects.read(m, { accept: "string" });
	const dataOf = (m) => (m.data instanceof Map ? m.data : new Map());
	const strftimeOf = (m) => ({
		format: typeof m.data === "string" ? m.data : strOf(m, "format"),
	});
	const intlOf = (m) => {
		const d = dataOf(m);
		const raw = d.get("options") instanceof Map ? d.get("options") : new Map();
		const options = {};
		for (const [k, v] of raw)
			if (typeof v === "string" || typeof v === "boolean") options[k] = String(v);
		return { locale: strOf(m, "locale"), options };
	};
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

	const decode = (C, bindings, msg) =>
		C.DatefmtLab({
			instants: listOf(
				C,
				"instants",
				(bindings.instants ?? kidsOf(msg, "instant")).map((m) =>
					C.InstantRow({ id: m.id, ...instantOf(m) }),
				),
				{ addLabel: "Instant" },
			),
			strftimes: listOf(
				C,
				"strftimes",
				(bindings.strftimes ?? kidsOf(msg, "strftime")).map((m) =>
					C.StrftimeRow({ id: m.id, ...strftimeOf(m), expect: expectOf(m) }),
				),
				{ addLabel: "strftime" },
			),
			intls: listOf(
				C,
				"intls",
				(bindings.intls ?? kidsOf(msg, "intl")).map((m) =>
					C.IntlRow({ id: m.id, ...intlOf(m), expect: expectOf(m) }),
				),
				{ addLabel: "Intl" },
			),
		});

	const instantData = (row) => (row.form === "inst" ? new Instant(BigInt(row.value)) : row.value);
	const strftimeData = (row, m) => new Map([...dataOf(m), ["format", row.format]]);
	const intlData = (row, m) => {
		const options = new Map(
			Object.entries(row.options).map(([k, v]) => [k, k === "hour12" ? v === "true" : v]),
		);
		return new Map([...dataOf(m), ["locale", row.locale], ["options", options]]);
	};
	// Per kind: how a part reads back, how a row writes its data, and whether it has expectations.
	const KINDS = {
		instant: { list: "instants", read: instantOf, write: instantData, expects: false },
		strftime: { list: "strftimes", read: strftimeOf, write: strftimeData, expects: true },
		intl: { list: "intls", read: intlOf, write: intlData, expects: true },
	};
	const rowData = (row, kind) =>
		kind === "instant"
			? { value: row.value, form: row.form }
			: kind === "strftime"
				? { format: row.format }
				: { locale: row.locale, options: Object.fromEntries(Object.entries(row.options).sort()) };
	const sameData = (m, row) => {
		const old = KINDS[m.kind].read(m);
		if (old.options) old.options = Object.fromEntries(Object.entries(old.options).sort());
		return same(old, rowData(row, m.kind));
	};
	const sameMeta = (m, row) => !KINDS[m.kind].expects || expects.same(expectOf(m), row.expect);
	// The encodeParts spec of a kind.
	const spec = (root, kind) => {
		const k = KINDS[kind];
		return {
			items: root[k.list].items,
			ordered: true,
			same: (m, row) => sameData(m, row) && sameMeta(m, row),
			update: (m, row) => ({
				...m,
				data: sameData(m, row) ? m.data : k.write(row, m),
				meta: sameMeta(m, row) ? m.meta : expects.withAll(m.meta, row.expect),
			}),
			create: (row) =>
				message(
					row.id,
					kind,
					k.write(row, { data: new Map() }),
					k.expects ? expects.metaFor(row.expect) : new Map(),
				),
		};
	};

	// msg with root's rows: untouched parts stay the same objects, removed ones go, new ones go at
	// the end, each kind's parts follow its list's order and parts of other kinds stay where they
	// are.
	const encode = (root, msg) =>
		encodeParts(msg, {
			instant: spec(root, "instant"),
			strftime: spec(root, "strftime"),
			intl: spec(root, "intl"),
		});

	// How the chat shows a set_strftime call: the pattern and what it gives for the first instant
	// (from the table it answers with), opening to every instant's output.
	const SetStrftimeCall = component({
		name: "SetStrftimeCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get format() {
				const { id = "?", format = "" } = this.call?.arguments ?? {};
				return `${id} = ${JSON.stringify(format)}`;
			},
			// The format's cell per instant: [{ instant, output, status }].
			get outputs() {
				const rows = this.resultJson;
				if (!Array.isArray(rows)) return [];
				const id = this.call?.arguments?.id;
				return rows.flatMap((r) =>
					(r.cells ?? [])
						.filter((c) => c.format === id)
						.map((c) => ({
							instant: r.instant,
							text: `${r.instant}: ${c.output || c.error}`,
							output: c.output,
							status: c.status,
						})),
				);
			},
			get sample() {
				const first = this.outputs[0];
				return first === undefined ? "" : `→ ${first.output || "error"}`;
			},
			get glimpse() {
				return this.sample === "" ? this.format : `${this.format} ${this.sample}`;
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				const statuses = this.outputs.map((o) => o.status);
				return statuses.some((x) => x !== "none")
					? expects.headline(statuses)
					: `${statuses.length} outputs`;
			},
			get stateClass() {
				return kit.ui.callStateClass(
					this.result,
					this.outputs.some((o) => o.status === "fail" || o.status === "error"),
				);
			},
		}),
		view: kit.ui.toolCallFrame(
			"glimpse",
			div(
				{ class: "flex flex-col gap-0.5 font-mono text-xs" },
				each(field("outputs"), span(field("text"))),
			),
		),
	});

	return {
		components: {
			...kit.ui.components,
			InstantRow,
			StrftimeRow,
			IntlRow,
			DatefmtLab,
			SetStrftimeCall,
		},
		root: "DatefmtLab",
		decode,
		encode,
		toolViews: { set_strftime: "SetStrftimeCall" },
	};
}
