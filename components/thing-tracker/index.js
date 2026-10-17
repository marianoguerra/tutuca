// A port of the UI of thing-tracker (github.com/marianoguerra/thing-tracker): tap an emoji
// to log a thing, see what you did by day, week or month, manage things, tags, bundles and
// backups. The app owns all data; panels and children notify it with what to change.
// Time is state (now, tz) the host keeps current, so every view is a function of it.

import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	provided,
	pushView,
	render,
	renderEach,
	renderIt,
	scopeOf,
	send,
	seqItem,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { EMOJI, EMOJI_CATEGORIES } from "./emoji.js";
import {
	commonValues,
	findMeasurement,
	findUnit,
	formatMeasurement,
	MEASUREMENTS,
	preferredUnit,
	textIn,
	toBase,
} from "./measure.js";
import {
	applyFrozenOrder,
	applyPlan,
	BUNDLES,
	bucketEvents,
	buildBackup,
	buildPack,
	buildRows,
	countMark,
	filterThings,
	importedText,
	matchesQuery,
	measurementHistory,
	normalize,
	parseEnvelope,
	planImport,
	rankThings,
	slugify,
	terms,
	UNGROUPED,
	usageOf,
	withGaps,
} from "./model.js";
import {
	DAY,
	dayKey,
	daysAgo,
	formatBucketLabel,
	formatDate,
	formatRelative,
	formatTime,
	fromDatetimeLocal,
	toDatetimeLocal,
} from "./time.js";

const {
	div,
	footer,
	h1,
	header,
	h2,
	h3,
	input,
	label,
	li,
	main,
	nav,
	p,
	section,
	span,
	textarea,
	ul,
} = tag;

// Looks, after shadcn's zinc theme in daisyUI terms.
const MUTED = "text-base-content/60";
const STICKY =
	"sticky top-0 z-20 border-b border-base-300 bg-base-100/85 px-4 py-2.5 backdrop-blur-lg";
const PILL = "rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0";
const PILL_ON = `${PILL} border-transparent bg-primary text-primary-content`;
const PILL_OFF = `${PILL} border-base-300 ${MUTED}`;
const SEG = "flex rounded-lg bg-base-200 p-0.5 text-sm font-medium";
const SEG_ON = "flex-1 rounded-md px-1.5 py-1.5 text-xs sm:text-sm bg-base-100 shadow-sm";
const SEG_OFF = `flex-1 rounded-md px-1.5 py-1.5 text-xs sm:text-sm ${MUTED}`;
const ICON_TOGGLE = "flex size-9 shrink-0 items-center justify-center rounded-md border";
const BANNER = "mx-4 mt-3 rounded-lg border border-base-300 bg-base-200/40 p-3 text-xs";
const LINK = "underline underline-offset-2 cursor-pointer";
const pick = (on) => (on ? PILL_ON : PILL_OFF);
const seg = (on) => (on ? SEG_ON : SEG_OFF);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const measureRef = (t) => t.record({ measurementId: t.string(), unit: t.string() });
const eventRecord = (t) =>
	t.record({
		id: t.string(),
		thingId: t.string(),
		recordedAt: t.number().int(),
		actualAt: t.number().int(),
		measurements: t.array(t.record({ measurementId: t.string(), value: t.number().min(0) })),
		notes: t.string(),
	});

// One thing: a button on Track, a row in Manage.
export const Thing = component({
	name: "Thing",
	fields: (t) => ({
		id: t.string(),
		emoji: t.string("⭐").len(1, 16),
		title: t.string().len(0, 120),
		description: t.string(),
		measurements: t.array(measureRef(t)),
		color: t.string(),
		archived: t.boolean(),
		bundleId: t.string(),
		// Kept by the app from the events.
		total: t.number().int().min(0),
		lastText: t.string("never"),
		tagsText: t.string("No tags"),
	}),
	methods: {
		get hasMeasurements() {
			return this.measurements.length > 0;
		},
		get ariaLabel() {
			return this.total === 0
				? `Log ${this.title}, never logged`
				: `Log ${this.title}, logged ${this.total} times, last ${this.lastText}`;
		},
		get hint() {
			return `${this.title} — tap to log now, hold to pick a time`;
		},
		get borderStyle() {
			return this.color === "" ? "" : `border-color: ${this.color}`;
		},
	},
	views: {
		main: button(
			{
				class:
					"flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-base-300 bg-base-100 px-1 py-2 select-none transition-transform active:scale-95",
				style: field("borderStyle"),
				title: field("hint"),
				"aria-label": field("ariaLabel"),
				"@on.click": send("tap"),
				"@on.contextmenu": send("hold"),
			},
			span(
				{ class: "emoji relative text-3xl leading-none" },
				field("emoji"),
				$if(
					field("hasMeasurements"),
					span({ class: "absolute -top-0.5 -right-2 text-[0.5rem] opacity-60" }, "📏"),
					"",
				),
			),
			span(
				{ class: "w-full truncate text-center text-[0.6875rem] leading-tight font-medium" },
				field("title"),
			),
			span({ class: `text-[0.625rem] leading-none tabular-nums ${MUTED}` }, field("lastText")),
		),
		compact: button(
			{
				class:
					"flex aspect-square items-center justify-center rounded-xl border border-base-300 bg-base-100 select-none transition-transform active:scale-95",
				style: field("borderStyle"),
				title: field("hint"),
				"aria-label": field("ariaLabel"),
				"@on.click": send("tap"),
				"@on.contextmenu": send("hold"),
			},
			span({ class: "emoji text-3xl leading-none" }, field("emoji")),
		),
		row: li(
			{},
			button(
				{ class: "flex w-full items-center gap-3 py-2.5 text-left", "@on.click": send("edit") },
				span({ class: "emoji text-2xl" }, field("emoji")),
				span(
					{ class: "min-w-0 flex-1" },
					span({ class: "block truncate text-sm font-medium" }, field("title")),
					span({ class: `block truncate text-xs ${MUTED}` }, field("tagsText")),
				),
			),
		),
	},
	on: {
		tap: {
			args: [],
			emits: { notify: ["logThing"] },
			run(_draft, _args, ctx) {
				ctx.notify("logThing", [this.id]);
			},
		},
		// A long press on touch, a right click with a mouse.
		hold: {
			args: [],
			emits: { notify: ["backdateThing"] },
			run(_draft, _args, ctx) {
				ctx.event?.preventDefault();
				ctx.notify("backdateThing", [this.id]);
			},
		},
		edit: {
			args: [],
			emits: { notify: ["editThing"] },
			run(_draft, _args, ctx) {
				ctx.notify("editThing", [this.id]);
			},
		},
	},
});

// A tag ("group" in the data).
export const Tag = component({
	name: "Tag",
	fields: (t) => ({
		id: t.string(),
		title: t.string().len(0, 120),
		emoji: t.string(),
		description: t.string(),
		sortOrder: t.number().int().min(0).max(1000000),
		thingIds: t.array(t.string()),
		bundleId: t.string(),
	}),
	methods: {
		get countText() {
			return plural(this.thingIds.length, "thing");
		},
		get shareLabel() {
			return `Share ${this.title}`;
		},
	},
	views: {
		main: span({ class: "inline-flex items-center gap-1" }, field("emoji"), field("title")),
		row: li(
			{ class: "flex items-center gap-2" },
			button(
				{
					class: "flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left",
					"@on.click": send("edit"),
				},
				span({ class: "emoji text-xl" }, field("emoji")),
				span({ class: "min-w-0 flex-1 truncate text-sm font-medium" }, field("title")),
				span({ class: `text-xs ${MUTED}` }, field("countText")),
			),
			button(
				{
					class: "btn btn-ghost btn-square btn-sm",
					"aria-label": field("shareLabel"),
					"@on.click": send("share"),
				},
				"⇪",
			),
		),
	},
	on: {
		edit: {
			args: [],
			emits: { notify: ["editTag"] },
			run(_draft, _args, ctx) {
				ctx.notify("editTag");
			},
		},
		share: {
			args: [],
			emits: { notify: ["shareTag"] },
			run(_draft, _args, ctx) {
				ctx.notify("shareTag");
			},
		},
	},
});

// A collapsible section of Track; its members are the app's things it names.
export const Section = component({
	name: "Section",
	fields: (t) => ({
		id: t.string(),
		title: t.string(),
		emoji: t.string(),
		memberIds: t.array(t.string()),
		isOpen: t.boolean(true),
		compact: t.boolean(),
	}),
	methods: {
		get count() {
			return this.memberIds.length;
		},
		get chevron() {
			return this.isOpen ? "▾" : "▸";
		},
		get gridClass() {
			return this.compact
				? "grid grid-cols-6 gap-2 px-4 pt-1 pb-2 min-[480px]:grid-cols-8"
				: "grid grid-cols-4 gap-2 px-4 pt-1 pb-2 min-[480px]:grid-cols-6";
		},
	},
	loops: {
		members: {
			prepare(items) {
				return new Map(items.map((thing, i) => [thing.id, i]));
			},
			*iter(items, index) {
				for (const id of this.memberIds) {
					const i = index.get(id);
					if (i !== undefined) yield [i, items[i]];
				}
			},
		},
	},
	view: section(
		{ class: "py-1" },
		h2(
			{},
			button(
				{
					class: `flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-semibold tracking-wide uppercase select-none ${MUTED}`,
					"aria-expanded": $if(field("isOpen"), "true", "false"),
					"@on.click": send("toggle"),
					"@on.contextmenu": send("toggleAll"),
				},
				span({ class: "w-3" }, field("chevron")),
				span({ class: "emoji" }, field("emoji")),
				span({ class: "truncate" }, field("title")),
				span({ class: "font-normal tabular-nums opacity-60" }, field("count")),
			),
		),
		// The members are the app's things, so a section alone shows only its header.
		$if(
			field("isOpen"),
			$if(
				provided("things"),
				div({ class: field("gridClass") }, each(provided("things"), renderIt(), "members")),
				"",
			),
			"",
		),
	),
	on: {
		toggle: {
			args: [],
			emits: { notify: ["toggleSection"] },
			run(_draft, _args, ctx) {
				ctx.notify("toggleSection", [this.id]);
			},
		},
		// From its members, on their way to the app.
		logThing: { args: [t.string()], run() {} },
		backdateThing: { args: [t.string()], run() {} },
		toggleAll: {
			args: [],
			emits: { notify: ["toggleAllSections"] },
			run(_draft, _args, ctx) {
				ctx.event?.preventDefault();
				ctx.notify("toggleAllSections");
			},
		},
	},
});

// A bucket of Insights, or the quiet days between two.
export const Bucket = component({
	name: "Bucket",
	fields: (t) => ({
		label: t.string(),
		start: t.number().int(),
		end: t.number().int(),
		total: t.number().int().min(0),
		gap: t.number().int().min(0),
		chips: t.array(
			t.record({
				thingId: t.string(),
				emoji: t.string(),
				aria: t.string(),
				tip: t.string(),
				mark: t.string(),
			}),
		),
	}),
	methods: {
		get isGap() {
			return this.gap > 0;
		},
		get gapText() {
			return `· ${plural(this.gap, "quiet day")} ·`;
		},
	},
	view: $if(
		field("isGap"),
		p({ class: "px-4 py-2 text-center text-xs opacity-60" }, field("gapText")),
		section(
			{ class: "border-b border-base-300/60 px-4 py-3" },
			h2(
				{
					class: `mb-2 flex items-baseline gap-2 text-xs font-semibold tracking-wide uppercase ${MUTED}`,
				},
				span(field("label")),
				span({ class: "font-normal tabular-nums opacity-60" }, field("total")),
			),
			div(
				{ class: "flex flex-wrap gap-1.5" },
				each(
					field("chips"),
					button(
						{
							class:
								"flex items-center gap-0.5 rounded-lg border border-base-300/60 bg-base-100 py-1.5 pr-1.5 pl-2 active:bg-base-200",
							"aria-label": field("aria"),
							title: field("tip"),
							"@on.click": send("open", sourceKey()),
						},
						span({ class: "emoji text-xl" }, field("emoji")),
						span({ class: `text-xs ${MUTED}` }, field("mark")),
					),
				),
			),
		),
	),
	on: {
		open: {
			args: [t.index("chips")],
			emits: { notify: ["openChip"] },
			run(_draft, [i], ctx) {
				const { start, end, label } = this;
				ctx.notify("openChip", [this.chips[i].thingId, start, end, label]);
			},
		},
	},
});

// The value of one measurement, as the measurement wizard asks it (main) or as the event
// editor shows it (field).
const CHIP = "rounded-full border px-3 py-1.5 text-xs font-medium";
const UNIT_BTN = "rounded px-2 py-1 text-xs font-medium";
const ADJUST =
	"flex min-h-12 items-center justify-center gap-1 rounded-xl border border-base-300 text-sm font-medium tabular-nums disabled:opacity-40";
export const Prompt = component({
	name: "Prompt",
	fields: (t) => ({
		measurementId: t.enum(...MEASUREMENTS.map((m) => m.id)),
		unitId: t.string(),
		base: t.number().min(0),
		text: t.string(),
		history: t.array(t.number().min(0)),
	}),
	methods: {
		get measurement() {
			return findMeasurement(MEASUREMENTS, this.measurementId);
		},
		get unit() {
			return findUnit(this.measurement.units, this.unitId) ?? this.measurement.units[0];
		},
		get heading() {
			return `${this.measurement.emoji} ${this.measurement.name}`;
		},
		get name() {
			return this.measurement.name;
		},
		get formatted() {
			return formatMeasurement(this.measurement, this.base, this.unit.id);
		},
		get hasValue() {
			return this.base > 0;
		},
		get hasUnits() {
			return this.measurement.units.length > 1;
		},
		get unitChips() {
			return this.measurement.units.map((u) => {
				const on = u.id === this.unit.id;
				return {
					value: u.id,
					label: u.label,
					symbol: u.symbol.trim() || u.label,
					pill: on
						? `${CHIP} border-transparent bg-primary text-primary-content`
						: `${CHIP} border-base-300 ${MUTED}`,
					button: on
						? `${UNIT_BTN} bg-primary text-primary-content`
						: `${UNIT_BTN} bg-base-200 ${MUTED}`,
				};
			});
		},
		get usual() {
			return commonValues(this.history).map((v) => ({
				value: String(v),
				label: formatMeasurement(this.measurement, v, this.unit.id),
				cls:
					v === this.base
						? "min-h-11 rounded-xl border border-transparent bg-primary px-4 text-sm font-medium tabular-nums text-primary-content"
						: "min-h-11 rounded-xl border border-base-300 px-4 text-sm font-medium tabular-nums",
			}));
		},
		get hasUsual() {
			return this.history.length > 0;
		},
		get stepUnit() {
			return findUnit(this.measurement.units, this.measurement.stepUnit) ?? this.unit;
		},
		get adjustTitle() {
			return `Adjust (${this.stepUnit.symbol.trim() || this.stepUnit.label})`;
		},
		get adjusts() {
			const { steps } = this.measurement;
			const name = this.stepUnit.label;
			return [
				...steps.map((v) => ({
					value: String(v),
					label: `+${v}`,
					aria: `Add ${v} ${name}`,
					disabled: false,
				})),
				...steps.map((v) => ({
					value: String(-v),
					label: `−${v}`,
					aria: `Subtract ${v} ${name}`,
					disabled: this.base <= 0,
				})),
			];
		},
	},
	views: {
		main: div(
			{ class: "flex flex-col" },
			h2(
				{
					class:
						"mb-4 flex items-center justify-center gap-1.5 text-center text-base font-semibold",
				},
				field("heading"),
			),
			input({
				type: "number",
				inputmode: "decimal",
				min: "0",
				step: "any",
				class: "input mx-auto block h-16 w-44 text-center text-3xl font-semibold tabular-nums",
				"aria-label": field("name"),
				value: field("text"),
				"@on.input": send("setText", targetValue()),
			}),
			p({ class: `mt-2 text-center text-sm ${MUTED}`, "aria-live": "polite" }, field("formatted")),
			$if(
				field("hasUnits"),
				div(
					{ class: "mt-4 flex flex-wrap justify-center gap-1.5" },
					each(
						field("unitChips"),
						button(
							{
								class: field("pill"),
								value: field("value"),
								"@on.click": send("setUnit", targetValue()),
							},
							field("label"),
						),
					),
				),
				"",
			),
			$if(
				field("hasUsual"),
				div(
					{ class: "mt-6" },
					h3({ class: `mb-2 text-xs font-medium ${MUTED}` }, "Usual"),
					div(
						{ class: "flex flex-wrap gap-2" },
						each(
							field("usual"),
							button(
								{
									class: field("cls"),
									value: field("value"),
									"@on.click": send("setBase", targetValue()),
								},
								field("label"),
							),
						),
					),
				),
				"",
			),
			div(
				{ class: "mt-6" },
				h3({ class: `mb-2 text-xs font-medium ${MUTED}` }, field("adjustTitle")),
				div(
					{ class: "grid grid-cols-3 gap-2" },
					each(
						field("adjusts"),
						button(
							{
								class: ADJUST,
								value: field("value"),
								disabled: field("disabled"),
								"aria-label": field("aria"),
								"@on.click": send("adjust", targetValue()),
							},
							field("label"),
						),
					),
				),
			),
		),
		field: div(
			{ class: "flex flex-col gap-1.5" },
			label({ class: "text-sm font-medium" }, field("name")),
			div(
				{ class: "flex items-start gap-2" },
				input({
					type: "number",
					inputmode: "decimal",
					min: "0",
					step: "any",
					placeholder: "0",
					class: "input input-sm w-24 tabular-nums",
					"aria-label": field("name"),
					value: field("text"),
					"@on.input": send("setText", targetValue()),
				}),
				div(
					{ class: "flex max-h-20 flex-wrap gap-1 overflow-y-auto" },
					each(
						field("unitChips"),
						button(
							{
								class: field("button"),
								value: field("value"),
								"@on.click": send("setUnit", targetValue()),
							},
							field("symbol"),
						),
					),
				),
			),
			$if(field("hasValue"), p({ class: `text-xs tabular-nums ${MUTED}` }, field("formatted")), ""),
		),
	},
	on: {
		setText: {
			args: [t.string()],
			run(draft, [text]) {
				draft.text = text;
				const n = Number.parseFloat(text);
				draft.base = text.trim() === "" || Number.isNaN(n) ? 0 : Math.max(0, toBase(n, this.unit));
			},
		},
		// Shows the same value in another unit.
		setUnit: {
			args: [t.string()],
			run(draft, [unitId]) {
				const u = findUnit(this.measurement.units, unitId);
				if (u === undefined) return;
				draft.unitId = u.id;
				draft.text = this.base > 0 || this.text !== "" ? textIn(this.base, u) : "";
			},
		},
		setBase: {
			args: [t.string()],
			run(draft, [value]) {
				const base = Number(value);
				if (!Number.isFinite(base) || base < 0) return;
				draft.base = base;
				draft.text = textIn(base, this.unit);
			},
		},
		adjust: {
			args: [t.string()],
			run(draft, [value]) {
				const steps = Number(value);
				if (!Number.isFinite(steps)) return;
				const base = Math.max(0, this.base + steps * this.stepUnit.factor);
				draft.base = base;
				draft.text = textIn(base, this.unit);
			},
		},
	},
});
// A prompt for measurement in a thing's unit, from its history; blank in the editor.
const makePrompt = (C, m, thingUnit, base, history, blank = false) => {
	const u = preferredUnit(m, thingUnit, base);
	return C.Prompt({
		measurementId: m.id,
		unitId: u.id,
		base,
		text: blank && base === 0 ? "" : textIn(base, u),
		history,
	});
};

const CATEGORY_ICONS = [
	"⭐",
	...EMOJI_CATEGORIES.map((c) => EMOJI.find((e) => e.category === c).char),
];
const CATEGORIES = ["Common", ...EMOJI_CATEGORIES];
const MAX_RESULTS = 300;
export const EmojiPicker = component({
	name: "EmojiPicker",
	fields: (t) => ({
		query: t.string(),
		category: t.enum(...CATEGORIES),
		value: t.string(),
		recent: t.array(t.string()).len(0, 16),
		paste: t.string(),
	}),
	methods: {
		get isSearching() {
			return this.query.trim() !== "";
		},
		get categoryChips() {
			return CATEGORIES.map((name, i) => ({
				name,
				icon: CATEGORY_ICONS[i],
				cls:
					name === this.category
						? "emoji size-9 rounded-lg text-lg bg-primary/20 ring-2 ring-primary"
						: "emoji size-9 rounded-lg text-lg hover:bg-base-200",
			}));
		},
		get matches() {
			if (!this.isSearching) {
				return this.category === "Common"
					? EMOJI
					: EMOJI.filter((e) => e.category === this.category);
			}
			const [first] = terms(this.query);
			const qs = terms(this.query);
			return EMOJI.map((e) => ({
				e,
				hay: normalize([e.name, e.category, ...e.keywords].join(" ")),
			}))
				.filter(({ hay }) => qs.every((q) => hay.includes(q)))
				.map(({ e }) => {
					const name = normalize(e.name);
					const score =
						name === first ? 40 : name.startsWith(first) ? 30 : name.includes(first) ? 20 : 10;
					return { e, score: score + 5 };
				})
				.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
				.map(({ e }) => e);
		},
		get results() {
			return this.matches
				.slice(0, MAX_RESULTS)
				.map((e) => ({ ...this.cell(e.char), name: e.name }));
		},
		cell(char) {
			return {
				char,
				cls:
					char === this.value
						? "emoji aspect-square rounded-md text-xl bg-primary/15 ring-2 ring-primary"
						: "emoji aspect-square rounded-md text-xl hover:bg-base-200",
			};
		},
		get recentCells() {
			return this.recent.map((char) => ({ ...this.cell(char), name: char }));
		},
		get showRecent() {
			return !this.isSearching && this.recent.length > 0;
		},
		get isEmpty() {
			return this.matches.length === 0;
		},
		get emptyText() {
			return `Nothing matches “${this.query.trim()}”. Paste any emoji below instead.`;
		},
		get isCapped() {
			return this.matches.length > MAX_RESULTS;
		},
		get capText() {
			return `Showing ${MAX_RESULTS} of ${this.matches.length}. Keep typing to narrow it down.`;
		},
	},
	view: div(
		{ class: "flex min-h-0 max-h-[45vh] flex-col gap-3" },
		input({
			type: "search",
			class: "input input-sm w-full",
			placeholder: "Search emoji…",
			"aria-label": "Search emoji",
			value: field("query"),
			"@on.input": send("setQuery", targetValue()),
		}),
		$if(
			field("isSearching"),
			"",
			div(
				{ class: "flex flex-wrap justify-center gap-1" },
				each(
					field("categoryChips"),
					button(
						{
							class: field("cls"),
							title: field("name"),
							"aria-label": field("name"),
							value: field("name"),
							"@on.click": send("setCategory", targetValue()),
						},
						field("icon"),
					),
				),
			),
		),
		$if(
			field("showRecent"),
			div(
				{},
				h3({ class: `mb-1 text-xs ${MUTED}` }, "Recent"),
				div(
					{ class: "grid grid-cols-8 gap-1" },
					each(
						field("recentCells"),
						button(
							{
								class: field("cls"),
								title: field("name"),
								value: field("char"),
								"@on.click": send("pick", targetValue()),
							},
							field("char"),
						),
					),
				),
			),
			"",
		),
		div(
			{ class: "min-h-0 flex-1 overflow-y-auto" },
			$if(
				field("isEmpty"),
				p({ class: `py-4 text-center text-sm ${MUTED}` }, field("emptyText")),
				div(
					{ class: "grid grid-cols-8 gap-1" },
					each(
						field("results"),
						button(
							{
								class: field("cls"),
								title: field("name"),
								value: field("char"),
								"@on.click": send("pick", targetValue()),
							},
							field("char"),
						),
					),
				),
			),
			$if(
				field("isCapped"),
				p({ class: `py-2 text-center text-xs ${MUTED}` }, field("capText")),
				"",
			),
		),
		label(
			{ class: "flex items-center gap-2 text-sm" },
			"Or paste any emoji",
			input({
				class: "input input-sm w-20 text-center text-lg",
				maxlength: "16",
				placeholder: "🦆",
				"aria-label": "Paste an emoji",
				value: field("paste"),
				"@on.input": send("pasted", targetValue()),
			}),
		),
	),
	on: {
		setQuery: {
			args: [t.string()],
			run(draft, [query]) {
				draft.query = query;
			},
		},
		setCategory: {
			args: [t.string()],
			run(draft, [category]) {
				if (CATEGORIES.includes(category)) draft.category = category;
			},
		},
		pick: {
			args: [t.string()],
			emits: { notify: ["emojiPicked"] },
			run(draft, [char], ctx) {
				if (char === "") return;
				draft.value = char;
				draft.recent = [char, ...this.recent.filter((c) => c !== char)].slice(0, 16);
				ctx.notify("emojiPicked", [char]);
			},
		},
		pasted: {
			args: [t.string()],
			emits: { notify: ["emojiPicked"] },
			run(draft, [text], ctx) {
				draft.paste = text;
				const char = text.trim();
				if (char === "" || char.length > 16) return;
				draft.value = char;
				ctx.notify("emojiPicked", [char]);
			},
		},
	},
});

// The chrome of a full screen panel; each panel has the messages of closing().
const panel = ({ title, description, extra = "", progress = null, body, foot }) =>
	div(
		{
			class: "absolute inset-0 z-40 flex flex-col bg-base-100",
			role: "dialog",
			"aria-modal": "true",
			"@on.keydown": send("key"),
		},
		header(
			{ class: "shrink-0 border-b border-base-300 pt-2 pb-2" },
			div(
				{ class: "mx-auto flex max-w-2xl items-center gap-2 px-3" },
				button(
					{
						class: "btn btn-ghost btn-square",
						"aria-label": "Close",
						"@on.click": send("requestClose"),
					},
					"✕",
				),
				div(
					{ class: "min-w-0 flex-1" },
					div({ class: "truncate text-sm font-medium" }, title),
					$if(description, div({ class: `truncate text-xs ${MUTED}` }, description), ""),
				),
				extra,
			),
		),
		progress === null
			? ""
			: div(
					{ class: "h-0.5 bg-base-200" },
					div({ class: "h-full bg-primary transition-all", style: progress }),
				),
		div(
			{ class: "min-h-0 flex-1 overflow-y-auto overscroll-contain" },
			div({ class: "mx-auto max-w-2xl px-4 py-4" }, body),
		),
		footer(
			{ class: "shrink-0 border-t border-base-300 pt-3 pb-3" },
			div({ class: "mx-auto flex max-w-2xl gap-2 px-4" }, foot),
		),
		$if(
			field("confirming"),
			div(
				{ class: "absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" },
				div(
					{
						class:
							"grid w-full max-w-xs gap-4 rounded-lg border border-base-300 bg-base-100 p-6 shadow-lg",
						role: "alertdialog",
					},
					div(
						{ class: "flex flex-col gap-2" },
						h2({ class: "text-lg leading-none font-semibold" }, field("confirmTitle")),
						p({ class: `text-sm ${MUTED}` }, field("confirmText")),
					),
					div(
						{ class: "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" },
						button(
							{ class: "btn btn-outline btn-sm", "@on.click": send("keepEditing") },
							field("keepLabel"),
						),
						button({ class: "btn btn-error btn-sm", "@on.click": send("discard") }, "Discard"),
					),
				),
			),
			"",
		),
	);
// Escape and ✕ ask first when the panel has something to lose.
const closing = (needsConfirm) => ({
	requestClose: {
		args: [],
		emits: { notify: ["closePanel"] },
		run(draft, _args, ctx) {
			if (needsConfirm.call(this)) draft.confirming = true;
			else ctx.notify("closePanel");
		},
	},
	key: {
		args: [],
		emits: { notify: ["closePanel"] },
		run(draft, _args, ctx) {
			if (ctx.event?.key !== "Escape") return;
			if (this.confirming) draft.confirming = false;
			else if (needsConfirm.call(this)) draft.confirming = true;
			else ctx.notify("closePanel");
		},
	},
	keepEditing: {
		args: [],
		run(draft) {
			draft.confirming = false;
		},
	},
	discard: {
		args: [],
		emits: { notify: ["closePanel"] },
		run(draft, _args, ctx) {
			draft.confirming = false;
			ctx.notify("closePanel");
		},
	},
});
const always = () => true;

export const MeasurementWizard = component({
	name: "MeasurementWizard",
	fields: (t) => ({
		thingId: t.string(),
		emoji: t.string(),
		title: t.string(),
		prompts: t.array(t.component("Prompt")).len(1),
		step: t.index("prompts"),
		confirming: t.boolean(),
	}),
	methods: {
		get current() {
			return this.prompts[this.step];
		},
		get heading() {
			return `${this.emoji} ${this.title}`;
		},
		get isMulti() {
			return this.prompts.length > 1;
		},
		get stepText() {
			return `${this.step + 1} of ${this.prompts.length}`;
		},
		get progressStyle() {
			return `width: ${Math.round(((this.step + 1) / this.prompts.length) * 100)}%`;
		},
		get hasBack() {
			return this.step > 0;
		},
		get isLast() {
			return this.step === this.prompts.length - 1;
		},
		get cannotGo() {
			return !(this.current.base > 0);
		},
		get primaryLabel() {
			return this.isLast ? `Log ${this.current.formatted}` : "Next";
		},
		confirmTitle: "Discard this entry?",
		confirmText: "Nothing has been logged yet.",
		keepLabel: "Keep going",
	},
	view: panel({
		title: field("heading"),
		description: "",
		extra: $if(
			field("isMulti"),
			span({ class: `text-xs tabular-nums ${MUTED}` }, field("stepText")),
			"",
		),
		progress: field("progressStyle"),
		body: render(seqItem("prompts", "step")),
		foot: [
			$if(
				field("hasBack"),
				button({ class: "btn btn-outline h-12 shrink-0", "@on.click": send("back") }, "← Back"),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1 text-base",
					disabled: field("cannotGo"),
					"@on.click": send("next"),
				},
				field("primaryLabel"),
			),
		],
	}),
	on: {
		...closing(always),
		back: {
			args: [],
			run(draft) {
				if (this.step > 0) draft.step = this.step - 1;
			},
		},
		next: {
			args: [],
			emits: { notify: ["commitLog"] },
			run(draft, _args, ctx) {
				if (!(this.current.base > 0)) return;
				if (!this.isLast) {
					draft.step = this.step + 1;
					return;
				}
				const values = this.prompts.map((pr) => ({
					measurementId: pr.measurementId,
					value: pr.base,
				}));
				ctx.notify("commitLog", [this.thingId, values]);
			},
		},
	},
});

export const EventEditor = component({
	name: "EventEditor",
	fields: (t) => ({
		mode: t.enum("create", "edit"),
		eventId: t.string(),
		thingId: t.string(),
		heading: t.string("Entry"),
		subtitle: t.string(),
		recordedAt: t.number().int(),
		when: t.string(),
		tz: t.number().int().min(-840).max(840),
		notes: t.string(),
		values: t.array(t.component("Prompt")),
		confirming: t.boolean(),
	}),
	methods: {
		get actualAt() {
			return fromDatetimeLocal(this.when, this.tz);
		},
		get isInvalid() {
			return this.actualAt === null;
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get primaryLabel() {
			return this.isEdit ? "Save" : "Log entry";
		},
		get confirmTitle() {
			return this.isEdit ? "Discard changes?" : "Discard this entry?";
		},
		get confirmText() {
			return this.isEdit ? "Your edits won't be saved." : "Nothing has been logged yet.";
		},
		keepLabel: "Keep editing",
	},
	loops: { fields: { view: "field" } },
	view: panel({
		title: field("heading"),
		description: field("subtitle"),
		body: div(
			{ class: "space-y-4" },
			div(
				{ class: "flex flex-col gap-1.5" },
				label({ class: "text-sm font-medium" }, "When did it happen?"),
				input({
					type: "datetime-local",
					class: "input input-sm w-full",
					"aria-label": "When did it happen?",
					"aria-invalid": $if(field("isInvalid"), "true", "false"),
					value: field("when"),
					"@on.input": send("setWhen", targetValue()),
				}),
				$if(field("isInvalid"), p({ class: "text-xs text-error" }, "That isn't a valid time."), ""),
			),
			renderEach(field("values"), "fields"),
			div(
				{ class: "flex flex-col gap-1.5" },
				label({ class: "text-sm font-medium" }, "Notes (optional)"),
				textarea({
					class: "textarea w-full",
					rows: "3",
					"aria-label": "Notes",
					placeholder: "Anything worth remembering about this one?",
					value: field("notes"),
					"@on.input": send("setNotes", targetValue()),
				}),
			),
		),
		foot: [
			$if(
				field("isEdit"),
				button(
					{ class: "btn btn-outline h-12 shrink-0 text-error", "@on.click": send("remove") },
					"Delete",
				),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1 text-base",
					disabled: field("isInvalid"),
					"@on.click": send("save"),
				},
				field("primaryLabel"),
			),
		],
	}),
	on: {
		...closing(always),
		setWhen: {
			args: [t.string()],
			run(draft, [when]) {
				draft.when = when;
			},
		},
		setNotes: {
			args: [t.string()],
			run(draft, [notes]) {
				draft.notes = notes;
			},
		},
		save: {
			args: [],
			emits: { notify: ["saveEntry"] },
			run(_draft, _args, ctx) {
				const { actualAt } = this;
				if (actualAt === null) return;
				const measurements = this.values
					.filter((v) => v.base > 0)
					.map((v) => ({ measurementId: v.measurementId, value: v.base }));
				const { mode, eventId: id, thingId, recordedAt, notes } = this;
				ctx.notify("saveEntry", [{ mode, id, thingId, recordedAt, actualAt, notes, measurements }]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["deleteEntry"] },
			run(_draft, _args, ctx) {
				ctx.notify("deleteEntry", [this.eventId]);
			},
		},
	},
});

const STEPS = ["Name & emoji", "What to record", "Notes"];
export const ThingEditor = component({
	name: "ThingEditor",
	fields: (t) => ({
		mode: t.enum("create", "edit"),
		thingId: t.string(),
		step: t.number().int().min(0).max(2),
		emoji: t.string("⭐"),
		title: t.string(),
		description: t.string(),
		measurements: t.array(measureRef(t)),
		pickerOpen: t.boolean(),
		picker: t.component("EmojiPicker"),
		clash: t.string(),
		confirming: t.boolean(),
	}),
	methods: {
		get heading() {
			return this.mode === "edit" ? "Edit thing" : "New thing";
		},
		get stepName() {
			return STEPS[this.step];
		},
		get stepText() {
			return `${this.step + 1} of 3`;
		},
		get progressStyle() {
			return `width: ${Math.round(((this.step + 1) / 3) * 100)}%`;
		},
		get isStep0() {
			return this.step === 0;
		},
		get isStep1() {
			return this.step === 1;
		},
		get isStep2() {
			return this.step === 2;
		},
		get hasBack() {
			return this.step > 0;
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get cannotGo() {
			return this.step === 0 && (this.title.trim() === "" || this.emoji === "");
		},
		get primaryLabel() {
			return this.step < 2 ? "Next" : this.isEdit ? "Save" : "Create";
		},
		get deleteLabel() {
			return `Delete ${this.title}`;
		},
		get hasClash() {
			return this.clash !== "";
		},
		get choices() {
			return [...MEASUREMENTS]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((m) => {
					const ref = this.measurements.find((r) => r.measurementId === m.id);
					return {
						id: m.id,
						label: `${m.emoji} ${m.name}`,
						checked: ref !== undefined,
						showUnits: ref !== undefined && m.units.length > 1,
						units: m.units.map((u) => ({
							value: `${m.id}|${u.id}`,
							label: u.label,
							cls:
								u.id === ref?.unit
									? "rounded-full border border-transparent bg-primary px-2 py-0.5 text-[0.6875rem] font-medium text-primary-content"
									: `rounded-full border border-base-300 px-2 py-0.5 text-[0.6875rem] font-medium ${MUTED}`,
						})),
					};
				});
		},
		get confirmTitle() {
			return this.isEdit ? "Discard changes?" : "Discard this thing?";
		},
		confirmText: "Nothing has been saved yet.",
		keepLabel: "Keep editing",
	},
	view: panel({
		title: field("heading"),
		description: field("stepName"),
		extra: span({ class: `text-xs tabular-nums ${MUTED}` }, field("stepText")),
		progress: field("progressStyle"),
		body: div(
			{},
			$if(
				field("isStep0"),
				div(
					{ class: "flex flex-col gap-3" },
					div(
						{ class: "flex items-start gap-3" },
						div(
							{ class: "flex flex-col gap-1.5" },
							label({ class: "text-sm font-medium" }, "Emoji"),
							button(
								{
									class:
										"emoji flex size-14 items-center justify-center rounded-xl border border-base-300 text-3xl",
									"aria-label": "Choose an emoji",
									"@on.click": send("togglePicker"),
								},
								field("emoji"),
							),
						),
						div(
							{ class: "flex flex-1 flex-col gap-1.5" },
							label({ class: "text-sm font-medium" }, "Name"),
							input({
								class: "input h-14 w-full text-base",
								placeholder: "Coffee",
								enterkeyhint: "done",
								"aria-label": "Name",
								value: field("title"),
								"@on.input": send("setTitle", targetValue()),
							}),
						),
					),
					$if(field("hasClash"), p({ class: `text-xs ${MUTED}` }, field("clash")), ""),
					$if(field("pickerOpen"), render(field("picker")), ""),
				),
				"",
			),
			$if(
				field("isStep1"),
				div(
					{ class: "flex flex-col gap-2" },
					label({ class: "text-sm font-medium" }, "Record a value when logging"),
					p(
						{ class: `text-xs ${MUTED}` },
						"Leave all unticked and one tap logs it outright. Tick any and tapping asks for them first, pre-filled with last time's.",
					),
					ul(
						{ class: "flex flex-col" },
						each(
							field("choices"),
							li(
								{ class: "flex flex-col" },
								label(
									{ class: "flex items-center gap-3 py-2 text-sm" },
									input({
										type: "checkbox",
										class: "checkbox checkbox-sm",
										checked: field("checked"),
										value: field("id"),
										"@on.change": send("toggleMeasurement", targetValue()),
									}),
									field("label"),
								),
								$if(
									field("showUnits"),
									div(
										{ class: "flex flex-wrap gap-1 pb-1.5 pl-9" },
										each(
											field("units"),
											button(
												{
													class: field("cls"),
													value: field("value"),
													"@on.click": send("setUnit", targetValue()),
												},
												field("label"),
											),
										),
									),
									"",
								),
							),
						),
					),
				),
				"",
			),
			$if(
				field("isStep2"),
				div(
					{ class: "flex flex-col gap-1.5" },
					label({ class: "text-sm font-medium" }, "Notes (optional)"),
					textarea({
						class: "textarea w-full",
						rows: "3",
						"aria-label": "Notes",
						placeholder: "What counts as one of these?",
						value: field("description"),
						"@on.input": send("setDescription", targetValue()),
					}),
				),
				"",
			),
		),
		foot: [
			$if(
				field("isEdit"),
				button(
					{
						class: "btn btn-outline btn-square size-12 text-error",
						"aria-label": field("deleteLabel"),
						"@on.click": send("remove"),
					},
					"🗑",
				),
				"",
			),
			$if(
				field("hasBack"),
				button({ class: "btn btn-outline h-12", "@on.click": send("back") }, "Back"),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1",
					disabled: field("cannotGo"),
					"@on.click": send("next"),
				},
				field("primaryLabel"),
			),
		],
	}),
	on: {
		...closing(always),
		togglePicker: {
			args: [],
			run(draft) {
				draft.pickerOpen = !this.pickerOpen;
			},
		},
		emojiPicked: {
			args: [t.string()],
			run(draft, [emoji], ctx) {
				draft.emoji = emoji;
				draft.pickerOpen = false;
				ctx.stopNext();
			},
		},
		setTitle: {
			args: [t.string()],
			run(draft, [title]) {
				draft.title = title;
			},
		},
		setDescription: {
			args: [t.string()],
			run(draft, [description]) {
				draft.description = description;
			},
		},
		// The checkbox's value is the measurement's id.
		toggleMeasurement: {
			args: [t.string()],
			run(draft, [value]) {
				const m = findMeasurement(MEASUREMENTS, value);
				if (m === undefined) return;
				const i = this.measurements.findIndex((r) => r.measurementId === m.id);
				if (i >= 0) draft.measurements.splice(i, 1);
				else draft.measurements.push({ measurementId: m.id, unit: m.defaultUnit });
			},
		},
		// A chip's value is "measurementId|unitId".
		setUnit: {
			args: [t.string()],
			run(draft, [value]) {
				const [measurementId, unitId] = value.split("|");
				const ref = draft.measurements.find((r) => r.measurementId === measurementId);
				const m = findMeasurement(MEASUREMENTS, measurementId);
				if (ref !== undefined && m !== undefined && findUnit(m.units, unitId) !== undefined)
					ref.unit = unitId;
			},
		},
		back: {
			args: [],
			run(draft) {
				if (this.step > 0) draft.step = this.step - 1;
			},
		},
		next: {
			args: [],
			emits: { notify: ["saveThing"] },
			run(draft, _args, ctx) {
				if (this.cannotGo) return;
				if (this.step < 2) {
					draft.step = this.step + 1;
					draft.pickerOpen = false;
					return;
				}
				const { mode, thingId: id, emoji, measurements } = this;
				const thing = {
					id,
					emoji,
					title: this.title.trim(),
					description: this.description.trim(),
					measurements,
				};
				ctx.notify("saveThing", [mode, thing]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["deleteThing"] },
			run(_draft, _args, ctx) {
				ctx.notify("deleteThing", [this.thingId]);
			},
		},
	},
});

export const TagEditor = component({
	name: "TagEditor",
	fields: (t) => ({
		mode: t.enum("create", "edit"),
		tagId: t.string(),
		emoji: t.string(),
		title: t.string(),
		pickerOpen: t.boolean(),
		picker: t.component("EmojiPicker"),
		query: t.string(),
		members: t.array(
			t.record({ id: t.string(), emoji: t.string(), title: t.string(), checked: t.boolean() }),
		),
		confirming: t.boolean(),
	}),
	methods: {
		get heading() {
			return this.mode === "edit" ? "Edit tag" : "New tag";
		},
		get isEdit() {
			return this.mode === "edit";
		},
		get emojiText() {
			return this.emoji || "＋";
		},
		get selectedText() {
			return `${this.members.filter((m) => m.checked).length} selected`;
		},
		get isEmpty() {
			return this.members.length === 0;
		},
		get cannotSave() {
			return this.title.trim() === "";
		},
		get confirmTitle() {
			return this.isEdit ? "Discard changes?" : "Discard this tag?";
		},
		confirmText: "Nothing has been saved yet.",
		keepLabel: "Keep editing",
	},
	loops: {
		// Alphabetical, by relevance while searching; ticking never reorders.
		members: {
			*iter(items) {
				const entries = [...items.entries()];
				if (this.query.trim() === "") yield* entries;
				else {
					const kept = new Set(filterThings(items, this.query));
					yield* entries.filter(([, m]) => kept.has(m));
				}
			},
		},
	},
	view: panel({
		title: field("heading"),
		description: "Pick which things this tag collects.",
		body: div(
			{ class: "flex flex-col gap-3" },
			div(
				{ class: "flex items-center gap-3" },
				button(
					{
						class:
							"emoji flex size-11 items-center justify-center rounded-xl border border-base-300 text-2xl",
						"aria-label": "Choose an emoji",
						"@on.click": send("togglePicker"),
					},
					field("emojiText"),
				),
				input({
					class: "input h-11 flex-1",
					placeholder: "Morning routine",
					"aria-label": "Tag name",
					value: field("title"),
					"@on.input": send("setTitle", targetValue()),
				}),
			),
			$if(field("pickerOpen"), render(field("picker")), ""),
			div(
				{ class: "flex items-center justify-between" },
				label({ class: "text-sm font-medium" }, "Things"),
				span({ class: `text-xs ${MUTED}` }, field("selectedText")),
			),
			input({
				type: "search",
				class: "input input-sm w-full",
				placeholder: "Search things…",
				"aria-label": "Search things",
				value: field("query"),
				"@on.input": send("setQuery", targetValue()),
			}),
			$if(
				field("isEmpty"),
				p({ class: `text-sm ${MUTED}` }, "No things to add yet."),
				ul(
					{ class: "flex flex-col" },
					each(
						field("members"),
						li(
							{},
							label(
								{ class: "flex items-center gap-3 py-2 text-sm" },
								input({
									type: "checkbox",
									class: "checkbox checkbox-sm",
									checked: field("checked"),
									"@on.change": send("toggleMember", sourceKey()),
								}),
								span({ class: "emoji" }, field("emoji")),
								field("title"),
							),
						),
						"members",
					),
				),
			),
		),
		foot: [
			$if(
				field("isEdit"),
				button({ class: "btn btn-outline h-12 text-error", "@on.click": send("remove") }, "Delete"),
				"",
			),
			button(
				{
					class: "btn btn-primary h-12 flex-1",
					disabled: field("cannotSave"),
					"@on.click": send("save"),
				},
				$if(field("isEdit"), "Save", "Create"),
			),
		],
	}),
	on: {
		...closing(always),
		togglePicker: {
			args: [],
			run(draft) {
				draft.pickerOpen = !this.pickerOpen;
			},
		},
		emojiPicked: {
			args: [t.string()],
			run(draft, [emoji], ctx) {
				draft.emoji = emoji;
				draft.pickerOpen = false;
				ctx.stopNext();
			},
		},
		setTitle: {
			args: [t.string()],
			run(draft, [title]) {
				draft.title = title;
			},
		},
		setQuery: {
			args: [t.string()],
			run(draft, [query]) {
				draft.query = query;
			},
		},
		toggleMember: {
			args: [t.index("members")],
			run(draft, [i]) {
				draft.members[i].checked = !this.members[i].checked;
			},
		},
		save: {
			args: [],
			emits: { notify: ["saveTag"] },
			run(_draft, _args, ctx) {
				if (this.cannotSave) return;
				const thingIds = this.members.filter((m) => m.checked).map((m) => m.id);
				const tag = { id: this.tagId, title: this.title.trim(), emoji: this.emoji, thingIds };
				ctx.notify("saveTag", [this.mode, tag]);
			},
		},
		remove: {
			args: [],
			emits: { notify: ["deleteTag"] },
			run(_draft, _args, ctx) {
				ctx.notify("deleteTag", [this.tagId]);
			},
		},
	},
});

const entryRow = (t) =>
	t.record({
		id: t.string(),
		head: t.string(),
		line: t.string(),
		notes: t.string(),
		recorded: t.string(),
	});
// A list of entries: of one thing in one bucket, or all of them.
export const EntryList = component({
	name: "EntryList",
	fields: (t) => ({
		heading: t.string("All entries"),
		subtitle: t.string(),
		rows: t.array(entryRow(t)),
		remaining: t.number().int().min(0),
		confirming: t.boolean(),
	}),
	methods: {
		get isEmpty() {
			return this.rows.length === 0;
		},
		get hasMore() {
			return this.remaining > 0;
		},
		get moreText() {
			return `Show ${Math.min(this.remaining, 200)} more (${this.remaining} left)`;
		},
		confirmTitle: "",
		confirmText: "",
		keepLabel: "",
	},
	view: panel({
		title: field("heading"),
		description: field("subtitle"),
		body: div(
			{},
			ul(
				{ class: "divide-y divide-base-300/60" },
				$if(field("isEmpty"), li({ class: `py-4 text-sm ${MUTED}` }, "No entries."), ""),
				each(
					field("rows"),
					li(
						{ class: "flex items-center gap-2 py-2.5" },
						button(
							{ class: "min-w-0 flex-1 text-left", "@on.click": send("open", sourceKey()) },
							$if(field("head"), div({ class: "text-sm font-medium" }, field("head")), ""),
							div({ class: "text-sm tabular-nums" }, field("line")),
							$if(field("notes"), div({ class: `truncate text-xs ${MUTED}` }, field("notes")), ""),
							$if(
								field("recorded"),
								div({ class: "text-[0.6875rem] opacity-50" }, field("recorded")),
								"",
							),
						),
						span({ class: "opacity-40" }, "›"),
						button(
							{
								class: "btn btn-ghost btn-square btn-sm",
								"aria-label": "Delete entry",
								"@on.click": send("remove", sourceKey()),
							},
							"🗑",
						),
					),
				),
			),
			$if(
				field("hasMore"),
				button(
					{ class: "btn btn-outline mt-3 w-full", "@on.click": send("more") },
					field("moreText"),
				),
				"",
			),
		),
		foot: button(
			{ class: "btn btn-outline h-12 flex-1", "@on.click": send("requestClose") },
			"Close",
		),
	}),
	on: {
		...closing(() => false),
		open: {
			args: [t.index("rows")],
			emits: { notify: ["editEntry"] },
			run(_draft, [i], ctx) {
				ctx.notify("editEntry", [this.rows[i].id]);
			},
		},
		remove: {
			args: [t.index("rows")],
			emits: { notify: ["deleteEntry"] },
			run(_draft, [i], ctx) {
				ctx.notify("deleteEntry", [this.rows[i].id]);
			},
		},
		more: {
			args: [],
			emits: { notify: ["moreEntries"] },
			run(_draft, _args, ctx) {
				ctx.notify("moreEntries");
			},
		},
	},
});

const PANELS = ["MeasurementWizard", "EventEditor", "ThingEditor", "TagEditor", "EntryList"];
const INTERVALS = [
	[1, "day"],
	[3, "3d"],
	[7, "week"],
	[14, "14d"],
	[30, "month"],
	[90, "90d"],
	[0, "never"],
];
const MANAGE_TABS = [
	["things", "Things"],
	["groups", "Tags"],
	["units", "Units"],
	["bundles", "Bundles"],
	["data", "Data"],
];
const TABS = [
	["track", "⚡", "Track"],
	["insights", "🗓", "Insights"],
	["manage", "⚙", "Manage"],
];

// The app's data as plain records, for backups, imports and the domain functions.
const plainThing = ({
	id,
	emoji,
	title,
	description,
	measurements,
	color,
	archived,
	bundleId,
}) => ({
	id,
	emoji,
	title,
	description,
	measurements: measurements.map(({ measurementId, unit }) => ({ measurementId, unit })),
	color,
	archived,
	bundleId,
});
const plainTag = ({ id, title, emoji, description, sortOrder, thingIds, bundleId }) => ({
	id,
	title,
	emoji,
	description,
	sortOrder,
	thingIds: [...thingIds],
	bundleId,
});
const plainEvent = ({ id, thingId, recordedAt, actualAt, measurements, notes }) => ({
	id,
	thingId,
	recordedAt,
	actualAt,
	measurements: measurements.map(({ measurementId, value }) => ({ measurementId, value })),
	notes,
});
const snapshotOf = (app) => ({
	things: app.things.map(plainThing),
	groups: app.groups.map(plainTag),
	events: app.events.map(plainEvent),
});
// Records from a file, with the fields our records require.
const thingFrom = (C, t) =>
	C.Thing({
		id: String(t.id),
		emoji: String(t.emoji ?? "⭐") || "⭐",
		title: String(t.title ?? "").slice(0, 120),
		description: String(t.description ?? ""),
		measurements: (t.measurements ?? [])
			.filter((m) => findMeasurement(MEASUREMENTS, m.measurementId))
			.map(({ measurementId, unit }) => ({ measurementId, unit: unit ?? "" })),
		color: String(t.color ?? ""),
		archived: Boolean(t.archived),
		bundleId: String(t.bundleId ?? ""),
	});
const tagFrom = (C, g, sortOrder) =>
	C.Tag({
		id: String(g.id),
		title: String(g.title ?? "").slice(0, 120),
		emoji: String(g.emoji ?? ""),
		description: String(g.description ?? ""),
		sortOrder: g.sortOrder ?? sortOrder,
		thingIds: g.thingIds.map(String),
		bundleId: String(g.bundleId ?? ""),
	});
const eventFrom = (e) => ({
	id: String(e.id),
	thingId: String(e.thingId),
	recordedAt: Math.trunc(e.recordedAt ?? e.actualAt),
	actualAt: Math.trunc(e.actualAt),
	measurements: (e.measurements ?? [])
		.filter((m) => m.value >= 0)
		.map(({ measurementId, value }) => ({ measurementId, value })),
	notes: String(e.notes ?? ""),
});

// Rebuilds what the app derives from its data and time: thing stats, Track's sections,
// Insights' buckets and an open entry list.
const refresh = (self, draft) => {
	const C = scopeOf(self).components;
	const { now, tz } = draft;
	const usage = usageOf(draft.events);
	const tagsOf = new Map();
	for (const g of draft.groups)
		for (const id of g.thingIds) tagsOf.set(id, [...(tagsOf.get(id) ?? []), g.title]);
	for (const thing of draft.things) {
		const u = usage.get(thing.id);
		thing.total = u?.total ?? 0;
		thing.lastText = u === undefined ? "never" : formatRelative(u.lastAt, now, tz);
		thing.tagsText = tagsOf.get(thing.id)?.join(" · ") ?? "No tags";
	}
	const visible = draft.things.filter((thing) => !thing.archived);
	const searching = draft.query.trim() !== "";
	const ordered = searching
		? filterThings(visible, draft.query)
		: applyFrozenOrder(visible, draft.order);
	draft.sections = buildRows(draft.groups, ordered).map((row) =>
		C.Section({
			...row,
			isOpen: searching || !draft.collapsed.includes(row.id),
			compact: draft.compact,
		}),
	);
	const group = draft.groups.find((g) => g.id === draft.groupFilter);
	const events =
		group === undefined
			? draft.events
			: draft.events.filter((e) => group.thingIds.includes(e.thingId));
	const buckets = bucketEvents(events, draft.granularity, tz);
	const thingOf = new Map(draft.things.map((thing) => [thing.id, thing]));
	draft.buckets = (draft.granularity === "day" ? withGaps(buckets) : buckets).map((b) =>
		b.gap !== undefined
			? C.Bucket({ gap: b.gap })
			: C.Bucket({
					label: formatBucketLabel(b.start, draft.granularity, now, tz),
					start: b.start,
					end: b.end,
					total: b.total,
					chips: b.chips.map((c) => {
						const thing = thingOf.get(c.thingId);
						const title = thing?.title ?? "Deleted thing";
						return {
							thingId: c.thingId,
							emoji: thing?.emoji ?? "❔",
							aria: `${title}, ${plural(c.count, "time")}`,
							tip: `${title} · ${c.count}`,
							mark: countMark(c.count),
						};
					}),
				}),
	);
	if (draft.listContext !== null) refreshList(draft, thingOf);
};
const entryLine = (e, tz, mixed, thing) => {
	const values = e.measurements.map((m) => {
		const measurement = findMeasurement(MEASUREMENTS, m.measurementId);
		return measurement === undefined ? "" : ` · ${formatMeasurement(measurement, m.value)}`;
	});
	return {
		id: e.id,
		head: mixed ? `${thing?.emoji ?? "❔"} ${thing?.title ?? "Deleted thing"}` : "",
		line: `${formatDate(e.actualAt, tz)} · ${formatTime(e.actualAt, tz)}${values.join("")}`,
		notes: e.notes,
		recorded:
			Math.abs(e.recordedAt - e.actualAt) > 60000 ? `recorded ${formatTime(e.recordedAt, tz)}` : "",
	};
};
const refreshList = (draft, thingOf) => {
	if (draft.panel?.rows === undefined) {
		draft.listContext = null;
		return;
	}
	const ctx = draft.listContext;
	const group = draft.groups.find((g) => g.id === draft.groupFilter);
	const all = draft.events
		.filter((e) =>
			ctx.thingId === ""
				? group === undefined || group.thingIds.includes(e.thingId)
				: e.thingId === ctx.thingId && e.actualAt >= ctx.start && e.actualAt < ctx.end,
		)
		.sort((a, b) => b.actualAt - a.actualAt);
	const shown = ctx.thingId === "" ? all.slice(0, draft.shownEntries) : all;
	const mixed = ctx.thingId === "";
	draft.panel.rows = shown.map((e) => entryLine(e, draft.tz, mixed, thingOf.get(e.thingId)));
	draft.panel.remaining = all.length - shown.length;
	if (mixed) draft.panel.subtitle = `${shown.length} of ${all.length}, newest first`;
};
// Shows a toast, gone after a while unless another replaces it first.
const toast = (draft, ctx, title, text, { eventId = "", kind = "info" } = {}) => {
	draft.toastSeq += 1;
	draft.toast = { id: draft.toastSeq, title, text, eventId, kind };
	ctx.ask("wait", [4000, draft.toastSeq]);
};
const newId = (draft, prefix) => {
	const id = `${prefix}-${draft.nextId}`;
	draft.nextId += 1;
	return id;
};
const openImport = (draft, ctx, title, text) => {
	const parsed = parseEnvelope(text);
	if (parsed.error !== undefined) {
		toast(draft, ctx, "Couldn't read that file", parsed.error, { kind: "error" });
		return;
	}
	draft.importSource = text;
	draft.importTitle =
		title ||
		(parsed.envelope.format === "thing-tracker/backup"
			? "Restore backup"
			: (parsed.envelope.bundle?.title ?? "Import tags"));
	draft.overwrite = false;
	draft.showPreview = true;
};

export const TrackerApp = component({
	name: "TrackerApp",
	fields: (t) => ({
		now: t.number().int().min(0),
		tz: t.number().int().min(-840).max(840),
		tab: t.enum("track", "insights", "manage"),
		things: t.array(t.component("Thing")),
		groups: t.array(t.component("Tag")),
		events: t.array(eventRecord(t)),
		order: t.array(t.string()),
		collapsed: t.array(t.string()),
		query: t.string(),
		compact: t.boolean(),
		sections: t.array(t.component("Section")),
		granularity: t.enum("day", "week", "month"),
		groupFilter: t.string(),
		buckets: t.array(t.component("Bucket")),
		shownEntries: t.number(200).int().min(1),
		listContext: t.option(t.record({ thingId: t.string(), start: t.number(), end: t.number() })),
		manageTab: t.enum(...MANAGE_TABS.map(([id]) => id)),
		manageQuery: t.string(),
		panel: t.option(t.component(PANELS)),
		toast: t.option(
			t.record({
				id: t.number().int(),
				title: t.string(),
				text: t.string(),
				eventId: t.string(),
				kind: t.enum("info", "logged", "error"),
			}),
		),
		toastSeq: t.number().int().min(0),
		hintShown: t.boolean(),
		nextId: t.number(1).int().min(1),
		backup: t.record({
			lastAt: t.number().min(0), // 0 when never.
			intervalDays: t.enum(7, 1, 3, 14, 30, 90, 0),
			dismissedAt: t.number().min(0),
			rangeText: t.string(),
		}),
		importMode: t.enum("merge", "replace"),
		importText: t.string(),
		importSource: t.string(),
		importTitle: t.string(),
		showPreview: t.boolean(),
		overwrite: t.boolean(),
	}),
	invariants: {
		statsMatchEvents() {
			const usage = usageOf(this.events);
			return this.things.every((thing) => thing.total === (usage.get(thing.id)?.total ?? 0));
		},
		eventsKnowTheirThing() {
			const ids = new Set(this.things.map((thing) => thing.id));
			return this.events.every((e) => ids.has(e.thingId));
		},
		uniqueIds() {
			const ids = [...this.things, ...this.groups, ...this.events].map((x) => x.id);
			return new Set(ids).size === ids.length;
		},
	},
	provides: {
		things(b) {
			b.field("things");
		},
	},
	methods: {
		snapshot() {
			return snapshotOf(this);
		},
		get isTrack() {
			return this.tab === "track";
		},
		get isInsights() {
			return this.tab === "insights";
		},
		get isManage() {
			return this.tab === "manage";
		},
		get tabButtons() {
			return TABS.map(([id, icon, text]) => ({
				id,
				icon,
				text,
				cls: `flex h-full w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium ${id === this.tab ? "" : MUTED}`,
				current: id === this.tab ? "page" : "false",
			}));
		},
		get hasPanel() {
			return this.panel !== null;
		},
		// Track.
		get hasThings() {
			return this.things.some((thing) => !thing.archived);
		},
		get searching() {
			return this.query.trim() !== "";
		},
		get noMatches() {
			return this.hasThings && this.sections.length === 0;
		},
		get noMatchText() {
			return `Nothing matches “${this.query.trim()}”.`;
		},
		get createText() {
			return `Create “${this.query.trim()}”`;
		},
		get anyOpen() {
			return this.sections.some((s) => s.isOpen);
		},
		get collapseLabel() {
			return this.anyOpen ? "Collapse all sections" : "Expand all sections";
		},
		get collapseIcon() {
			return this.anyOpen ? "⇡" : "⇣";
		},
		get compactClass() {
			return this.compact
				? `${ICON_TOGGLE} border-transparent bg-primary text-primary-content`
				: `${ICON_TOGGLE} border-base-300 ${MUTED}`;
		},
		get compactLabel() {
			return this.compact ? "Show labels" : "Hide labels";
		},
		get gridView() {
			return this.compact ? "compact" : "main";
		},
		get backupDue() {
			const { intervalDays, lastAt, dismissedAt } = this.backup;
			if (intervalDays === 0) return false;
			const interval = intervalDays * DAY;
			if (dismissedAt > 0 && this.now - dismissedAt < interval) return false;
			return lastAt === 0 || this.now - lastAt >= interval;
		},
		get backupTitle() {
			return this.backup.lastAt === 0 ? "You haven't backed up yet" : "Time for a backup";
		},
		get backupText() {
			return this.backup.lastAt === 0
				? "Everything you've logged lives only in this browser. One file keeps it safe."
				: `Your last backup was ${daysAgo(this.backup.lastAt, this.now)}.`;
		},
		get hasToast() {
			return this.toast !== null;
		},
		get toastCanEdit() {
			return this.toast?.kind === "logged";
		},
		get toastTitle() {
			return this.toast?.title ?? "";
		},
		get toastText() {
			return this.toast?.text ?? "";
		},
		get toastClass() {
			return this.toast?.kind === "error"
				? "flex items-start gap-3 rounded-lg border border-error/40 bg-base-100 p-3 text-sm shadow-lg"
				: "flex items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-sm shadow-lg";
		},
		// Insights.
		get granularityButtons() {
			return ["day", "week", "month"].map((g) => ({
				value: g,
				text: g[0].toUpperCase() + g.slice(1),
				cls:
					g === this.granularity
						? "flex-1 rounded-md px-3 py-1.5 bg-base-100 shadow-sm"
						: `flex-1 rounded-md px-3 py-1.5 ${MUTED}`,
			}));
		},
		get hasUsedGroups() {
			const ids = new Set(this.things.map((thing) => thing.id));
			return this.groups.some((g) => g.thingIds.some((id) => ids.has(id)));
		},
		get allChipClass() {
			return pick(this.groupFilter === "");
		},
		get noEvents() {
			return this.buckets.length === 0;
		},
		// Manage.
		get manageTabs() {
			return MANAGE_TABS.map(([id, text]) => ({ id, text, cls: seg(id === this.manageTab) }));
		},
		get isThingsTab() {
			return this.manageTab === "things";
		},
		get isGroupsTab() {
			return this.manageTab === "groups";
		},
		get isUnitsTab() {
			return this.manageTab === "units";
		},
		get isBundlesTab() {
			return this.manageTab === "bundles";
		},
		get isDataTab() {
			return this.manageTab === "data";
		},
		get manageNoMatch() {
			return `Nothing matches “${this.manageQuery.trim()}”.`;
		},
		get thingsEmpty() {
			return this.things.length === 0;
		},
		get groupsEmpty() {
			return this.groups.length === 0;
		},
		get unitRows() {
			return [...MEASUREMENTS]
				.filter((m) =>
					matchesQuery(
						[m.name, m.emoji, ...m.units.flatMap((u) => [u.label, u.symbol])],
						this.manageQuery,
					),
				)
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((m) => {
					const n = this.things.filter((thing) =>
						thing.measurements.some((r) => r.measurementId === m.id),
					).length;
					return {
						emoji: m.emoji,
						name: m.name,
						usage: n === 0 ? "unused" : plural(n, "thing"),
						units: m.units.map((u) => u.symbol.trim() || u.label).join(" · "),
					};
				});
		},
		get bundleCards() {
			return BUNDLES.filter((b) =>
				matchesQuery([b.title, b.description, b.emoji], this.manageQuery),
			).map((b) => {
				const added = this.things.some((thing) => thing.bundleId === b.id);
				return {
					id: b.id,
					emoji: b.emoji,
					title: b.title,
					description: b.description,
					counts: `${b.thingCount} things · ${plural(b.groupCount, "tag")}`,
					added,
					action: added ? "Re-check" : "Add",
					cls: added ? "btn btn-outline btn-sm" : "btn btn-primary btn-sm",
				};
			});
		},
		get countsText() {
			return `${this.things.length} things · ${this.groups.length} tags · ${this.events.length} entries`;
		},
		get backupStatus() {
			const { lastAt, rangeText } = this.backup;
			if (lastAt === 0) return "No backup made yet.";
			return `Last backup ${daysAgo(lastAt, this.now)}${rangeText ? `, covering ${rangeText}` : ""}.`;
		},
		get intervalChips() {
			return INTERVALS.map(([days, text]) => ({
				value: String(days),
				text,
				cls: pick(days === this.backup.intervalDays),
			}));
		},
		get modeButtons() {
			return ["merge", "replace"].map((mode) => ({
				value: mode,
				text: mode === "merge" ? "Merge" : "Replace",
				cls:
					mode === this.importMode
						? "flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-content"
						: "flex-1 rounded-md border border-base-300 px-3 py-1.5 text-sm font-medium",
			}));
		},
		get modeText() {
			return this.importMode === "merge"
				? "Keeps what's here and adds what's missing. Entries are never duplicated."
				: "Deletes everything on this device first. Only applies to full backups.";
		},
		get plan() {
			const parsed = parseEnvelope(this.importSource);
			if (parsed.error !== undefined) return null;
			return planImport(parsed.envelope, this.snapshot(), {
				mode: this.importMode,
				overwrite: this.overwrite,
			});
		},
		get preview() {
			const plan = this.plan;
			if (plan === null)
				return {
					lines: [],
					warnings: [],
					description: "",
					isNoop: true,
					canOverwrite: false,
					replace: false,
				};
			const description = plan.isNoop
				? "You already have every thing in this file."
				: "Here's what will change on this device.";
			return { ...plan, description };
		},
		get previewLines() {
			return this.preview.lines;
		},
		get previewWarnings() {
			return this.preview.warnings;
		},
		get previewDescription() {
			return this.preview.description;
		},
		get previewNoop() {
			return this.preview.isNoop;
		},
		get previewCanOverwrite() {
			return this.preview.canOverwrite;
		},
		get confirmImportLabel() {
			return this.preview.replace ? "Replace everything" : "Import";
		},
		get confirmImportClass() {
			return this.preview.replace ? "btn btn-error btn-sm" : "btn btn-primary btn-sm";
		},
	},
	loops: {
		usedGroups: {
			*iter(items) {
				const ids = new Set(this.things.map((thing) => thing.id));
				const used = [...items.entries()].filter(([, g]) => g.thingIds.some((id) => ids.has(id)));
				yield* used.sort(
					([, a], [, b]) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
				);
			},
			enrich({ value }) {
				return { chip: pick(value.id === this.groupFilter) };
			},
		},
		manageThings: {
			view: "row",
			*iter(items) {
				const entries = [...items.entries()];
				if (this.manageQuery.trim() !== "") {
					const kept = filterThings(items, this.manageQuery);
					yield* kept.map((thing) => entries.find(([, x]) => x === thing));
				} else yield* entries.sort(([, a], [, b]) => a.title.localeCompare(b.title));
			},
		},
		manageGroups: {
			view: "row",
			*iter(items) {
				const kept = [...items.entries()].filter(([, g]) =>
					matchesQuery([g.title, g.description, g.emoji], this.manageQuery),
				);
				yield* kept.sort(
					([, a], [, b]) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
				);
			},
		},
	},
	view: div(
		{
			class:
				"relative mx-auto flex min-h-[40rem] w-full max-w-2xl flex-col overflow-hidden bg-base-100 text-base-content",
		},
		main(
			{ class: "min-h-0 flex-1 overflow-y-auto pb-20" },
			trackView(),
			insightsView(),
			manageView(),
		),
		nav(
			{
				class:
					"absolute inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100/85 backdrop-blur-lg",
			},
			ul(
				{ class: "mx-auto flex h-16 max-w-2xl" },
				each(
					field("tabButtons"),
					li(
						{ class: "flex-1" },
						button(
							{
								class: field("cls"),
								"aria-current": field("current"),
								value: field("id"),
								"@on.click": send("setTab", targetValue()),
							},
							span({ class: "text-lg leading-none" }, field("icon")),
							field("text"),
						),
					),
				),
			),
		),
		$if(
			field("hasToast"),
			div(
				{ class: "absolute inset-x-0 bottom-20 z-30 flex justify-center px-4", role: "status" },
				div(
					{ class: field("toastClass") },
					div(
						{ class: "min-w-0 flex-1" },
						div({ class: "font-medium" }, field("toastTitle")),
						div(
							{ class: `text-xs ${MUTED}` },
							field("toastText"),
							$if(
								field("toastCanEdit"),
								button({ class: `ml-1 ${LINK}`, "@on.click": send("editToast") }, "Edit"),
								"",
							),
						),
					),
					$if(
						field("toastCanEdit"),
						button({ class: "btn btn-xs", "@on.click": send("undoToast") }, "Undo"),
						"",
					),
					button(
						{
							class: "btn btn-ghost btn-xs",
							"aria-label": "Dismiss",
							"@on.click": send("dismissToast"),
						},
						"✕",
					),
				),
			),
			"",
		),
		$if(field("showPreview"), importDialog(), ""),
		$if(field("hasPanel"), render(field("panel")), ""),
	),
	on: {
		setTab: {
			args: [t.string()],
			run(draft, [tab]) {
				if (TABS.some(([id]) => id === tab)) draft.tab = tab;
			},
		},
		// Time: the host asks for it, or sends it.
		syncNow: {
			args: [],
			emits: { ask: ["now"] },
			run(_draft, _args, ctx) {
				ctx.ask("now");
			},
		},
		nowReplyOk(draft, [now]) {
			if (!Number.isInteger(now) || now < 0) return;
			draft.now = now;
			refresh(this, draft);
		},
		nowReplyError() {},
		nowHandlerNotFound() {},
		setNow: {
			args: [t.number().int().min(0)],
			run(draft, [now]) {
				draft.now = now;
				refresh(this, draft);
			},
		},
		// Re-sorts Track by use; the original does it when the app comes back to the front.
		reorder: {
			args: [],
			run(draft) {
				draft.order = rankThings(
					this.things.filter((thing) => !thing.archived),
					usageOf(this.events),
				);
				refresh(this, draft);
			},
		},
		// Track.
		setQuery: {
			args: [t.string()],
			run(draft, [query]) {
				draft.query = query;
				refresh(this, draft);
			},
		},
		toggleCompact: {
			args: [],
			run(draft) {
				draft.compact = !this.compact;
				refresh(this, draft);
			},
		},
		toggleSection: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				if (this.searching) return;
				draft.collapsed = this.collapsed.includes(id)
					? this.collapsed.filter((c) => c !== id)
					: [...this.collapsed, id];
				refresh(this, draft);
			},
		},
		// Collapses all when any is open, else expands all; keeps ids not on screen.
		toggleAllSections: {
			args: [],
			run(draft, _args, ctx) {
				ctx.stopNext();
				const ids = this.sections.map((s) => s.id);
				draft.collapsed = this.anyOpen
					? [...new Set([...this.collapsed, ...ids])]
					: this.collapsed.filter((id) => !ids.includes(id));
				refresh(this, draft);
			},
		},
		logThing: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === id);
				if (thing === undefined) return;
				const C = scopeOf(this).components;
				const prompts = thing.measurements.flatMap((ref) => {
					const m = findMeasurement(MEASUREMENTS, ref.measurementId);
					if (m === undefined) return [];
					const history = measurementHistory(this.events, thing.id, m.id);
					const u = preferredUnit(m, ref.unit);
					return [makePrompt(C, m, ref.unit, history[0] ?? u.factor, history)];
				});
				if (prompts.length === 0) logEvent(this, draft, ctx, thing, []);
				else
					draft.panel = C.MeasurementWizard({
						thingId: thing.id,
						emoji: thing.emoji,
						title: thing.title,
						prompts,
					});
			},
		},
		commitLog: {
			args: [
				t.string(),
				t.array(t.record({ measurementId: t.string(), value: t.number().min(0) })),
			],
			run(draft, [thingId, values], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === thingId);
				draft.panel = null;
				if (thing !== undefined) logEvent(this, draft, ctx, thing, values);
			},
		},
		// Opens the editor on an unsaved entry for now, with last time's values.
		backdateThing: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === id);
				if (thing === undefined) return;
				const C = scopeOf(this).components;
				const values = thing.measurements.flatMap((ref) => {
					const m = findMeasurement(MEASUREMENTS, ref.measurementId);
					if (m === undefined) return [];
					const history = measurementHistory(this.events, thing.id, m.id);
					return [makePrompt(C, m, ref.unit, history[0] ?? 0, history, true)];
				});
				draft.panel = C.EventEditor({
					mode: "create",
					thingId: thing.id,
					heading: `${thing.emoji} ${thing.title}`,
					subtitle: "Set when this happened.",
					recordedAt: this.now,
					when: toDatetimeLocal(this.now, this.tz),
					tz: this.tz,
					values,
				});
			},
		},
		saveEntry: {
			args: [
				t.record({
					mode: t.enum("create", "edit"),
					id: t.string(),
					thingId: t.string(),
					recordedAt: t.number().int(),
					actualAt: t.number().int(),
					notes: t.string(),
					measurements: t.array(t.record({ measurementId: t.string(), value: t.number().min(0) })),
				}),
			],
			run(draft, [entry], ctx) {
				ctx.stopNext();
				const { mode, id, thingId, recordedAt, actualAt, notes, measurements } = entry;
				if (mode === "create" && !this.things.some((x) => x.id === thingId)) return;
				const record = {
					thingId,
					recordedAt,
					actualAt,
					notes: notes.trim() ? notes : "",
					measurements,
				};
				if (mode === "create") draft.events.push({ id: newId(draft, "event"), ...record });
				else {
					const e = draft.events.find((x) => x.id === id);
					if (e !== undefined)
						Object.assign(e, {
							actualAt,
							notes: record.notes,
							measurements: measurements.filter((m) => m.value > 0),
						});
				}
				draft.panel = null;
				draft.listContext = null;
				refresh(this, draft);
			},
		},
		editEntry: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				openEntry(this, draft, id);
			},
		},
		deleteEntry: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				draft.events = draft.events.filter((e) => e.id !== id);
				if (this.panel?.eventId === id) draft.panel = null;
				refresh(this, draft);
			},
		},
		closePanel(draft, _args, ctx) {
			ctx.stopNext();
			draft.panel = null;
			draft.listContext = null;
		},
		// Toasts.
		undoToast: {
			args: [],
			run(draft) {
				const id = this.toast?.eventId;
				draft.toast = null;
				if (!id) return;
				draft.events = draft.events.filter((e) => e.id !== id);
				refresh(this, draft);
			},
		},
		editToast: {
			args: [],
			run(draft) {
				const id = this.toast?.eventId;
				draft.toast = null;
				if (id) openEntry(this, draft, id);
			},
		},
		dismissToast: {
			args: [],
			run(draft) {
				draft.toast = null;
			},
		},
		// A toast's timer ran out; the first log's is followed by a tip.
		waitReplyOk(draft, [id], ctx) {
			if (this.toast?.id !== id) return;
			draft.toast = null;
			if (!this.hintShown && this.toast.kind === "logged") {
				draft.hintShown = true;
				toast(
					draft,
					ctx,
					"Tip",
					"Press and hold a thing to log it at a different time, or a section header to collapse everything.",
				);
				ctx.ask("wait", [6000, draft.toastSeq]);
			}
		},
		waitReplyError() {},
		waitHandlerNotFound() {},
		// Insights.
		setGranularity: {
			args: [t.string()],
			run(draft, [granularity]) {
				if (!["day", "week", "month"].includes(granularity)) return;
				draft.granularity = granularity;
				refresh(this, draft);
			},
		},
		setGroupFilter: {
			args: [t.index("groups")],
			run(draft, [i]) {
				const { id } = this.groups[i];
				draft.groupFilter = id === this.groupFilter ? "" : id;
				refresh(this, draft);
			},
		},
		clearGroupFilter: {
			args: [],
			run(draft) {
				draft.groupFilter = "";
				refresh(this, draft);
			},
		},
		openChip: {
			args: [t.string(), t.number(), t.number(), t.string()],
			run(draft, [thingId, start, end, bucketLabel], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === thingId);
				const C = scopeOf(this).components;
				draft.panel = C.EntryList({
					heading: thing === undefined ? "❔ Deleted thing" : `${thing.emoji} ${thing.title}`,
					subtitle: bucketLabel,
				});
				draft.listContext = { thingId, start, end };
				refresh(this, draft);
			},
		},
		openAllEntries: {
			args: [],
			run(draft) {
				draft.shownEntries = 200;
				draft.panel = scopeOf(this).components.EntryList({ heading: "All entries" });
				draft.listContext = { thingId: "", start: 0, end: 0 };
				refresh(this, draft);
			},
		},
		moreEntries(draft, _args, ctx) {
			ctx.stopNext();
			draft.shownEntries = this.shownEntries + 200;
			refresh(this, draft);
		},
		// Things.
		newThing: {
			args: [t.string()],
			run(draft, [title]) {
				const C = scopeOf(this).components;
				draft.panel = C.ThingEditor({ mode: "create", title, pickerOpen: true });
			},
		},
		newThingFromQuery: {
			args: [],
			run(draft) {
				const C = scopeOf(this).components;
				draft.panel = C.ThingEditor({ mode: "create", title: this.query.trim(), pickerOpen: true });
			},
		},
		editThing: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				const thing = this.things.find((x) => x.id === id);
				if (thing === undefined) return;
				const C = scopeOf(this).components;
				// The same emoji as a thing sharing one of its tags.
				const peers = this.groups
					.filter((g) => g.thingIds.includes(thing.id))
					.flatMap((g) => g.thingIds);
				const other = this.things.find(
					(x) => x.id !== thing.id && x.emoji === thing.emoji && peers.includes(x.id),
				);
				draft.panel = C.ThingEditor({
					mode: "edit",
					thingId: thing.id,
					emoji: thing.emoji,
					title: thing.title,
					description: thing.description,
					measurements: thing.measurements.map((r) => ({ ...r })),
					clash:
						other === undefined
							? ""
							: `${thing.emoji} is already used by ${other.title} in one of the same groups — still fine, just harder to tell apart at a glance.`,
				});
			},
		},
		saveThing: {
			args: [
				t.enum("create", "edit"),
				t.record({
					id: t.string(),
					emoji: t.string().len(1, 16),
					title: t.string().len(0, 120),
					description: t.string(),
					measurements: t.array(measureRef(t)),
				}),
			],
			run(draft, [mode, thing], ctx) {
				ctx.stopNext();
				const C = scopeOf(this).components;
				if (mode === "create") {
					const id = newId(draft, "thing");
					draft.things.push(C.Thing({ ...thing, id }));
					draft.order.push(id);
				} else {
					const local = draft.things.find((x) => x.id === thing.id);
					if (local !== undefined) {
						Object.assign(local, {
							emoji: thing.emoji,
							title: thing.title,
							description: thing.description,
							measurements: thing.measurements,
						});
					}
				}
				draft.panel = null;
				refresh(this, draft);
			},
		},
		// Its entries go too, and it leaves every tag.
		deleteThing: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				draft.events = draft.events.filter((e) => e.thingId !== id);
				for (const g of draft.groups)
					if (g.thingIds.includes(id)) g.thingIds = g.thingIds.filter((x) => x !== id);
				draft.things = draft.things.filter((x) => x.id !== id);
				draft.panel = null;
				refresh(this, draft);
			},
		},
		// Tags.
		newTag: {
			args: [],
			run(draft) {
				openTagEditor(this, draft, null);
			},
		},
		editTag: {
			args: [],
			sourceKey: t.index("groups"),
			run(draft, _args, ctx) {
				ctx.stopNext();
				openTagEditor(this, draft, this.groups[ctx.sourceKey]);
			},
		},
		saveTag: {
			args: [
				t.enum("create", "edit"),
				t.record({
					id: t.string(),
					title: t.string().len(0, 120),
					emoji: t.string(),
					thingIds: t.array(t.string()),
				}),
			],
			run(draft, [mode, given], ctx) {
				ctx.stopNext();
				const C = scopeOf(this).components;
				const known = new Set(this.things.map((x) => x.id));
				const tag = { ...given, thingIds: given.thingIds.filter((id) => known.has(id)) };
				if (mode === "create") {
					const sortOrder = Math.max(-1, ...this.groups.map((g) => g.sortOrder)) + 1;
					draft.groups.push(C.Tag({ ...tag, id: newId(draft, "tag"), sortOrder }));
				} else {
					const local = draft.groups.find((g) => g.id === tag.id);
					if (local !== undefined)
						Object.assign(local, { title: tag.title, emoji: tag.emoji, thingIds: tag.thingIds });
				}
				draft.panel = null;
				refresh(this, draft);
			},
		},
		deleteTag: {
			args: [t.string()],
			run(draft, [id], ctx) {
				ctx.stopNext();
				draft.groups = draft.groups.filter((g) => g.id !== id);
				if (this.groupFilter === id) draft.groupFilter = "";
				draft.panel = null;
				refresh(this, draft);
			},
		},
		shareTag: {
			args: [],
			sourceKey: t.index("groups"),
			emits: { ask: ["saveFile"] },
			run(_draft, _args, ctx) {
				ctx.stopNext();
				const g = this.groups[ctx.sourceKey];
				const pack = buildPack([plainTag(g)], this.things.map(plainThing), this.now);
				const file = `thing-tracker-pack-${g.bundleId || slugify(g.title)}-${dayKey(this.now, this.tz)}.json`;
				ctx.ask("saveFile", [file, JSON.stringify(pack, null, 2), "share"]);
			},
		},
		// Manage.
		setManageTab: {
			args: [t.string()],
			run(draft, [tab]) {
				if (!MANAGE_TABS.some(([id]) => id === tab)) return;
				draft.manageTab = tab;
				draft.manageQuery = "";
			},
		},
		setManageQuery: {
			args: [t.string()],
			run(draft, [query]) {
				draft.manageQuery = query;
			},
		},
		browseBundles: {
			args: [],
			run(draft) {
				draft.tab = "manage";
				draft.manageTab = "bundles";
				draft.manageQuery = "";
			},
		},
		// Backups.
		backupNow: {
			args: [],
			run(draft) {
				draft.tab = "manage";
				draft.manageTab = "data";
			},
		},
		backupLater: {
			args: [],
			run(draft) {
				draft.backup.dismissedAt = this.now;
			},
		},
		setInterval: {
			args: [t.string()],
			run(draft, [days]) {
				const n = Number(days);
				if (!INTERVALS.some(([d]) => d === n)) return;
				draft.backup.intervalDays = n;
				draft.backup.dismissedAt = 0;
			},
		},
		exportAll: {
			args: [],
			emits: { ask: ["saveFile"] },
			run(_draft, _args, ctx) {
				const backup = buildBackup(this.snapshot(), this.now);
				const { from, to } = backup.range;
				const name =
					from === null
						? dayKey(this.now, this.tz)
						: `${dayKey(from, this.tz)}_to_${dayKey(to, this.tz)}`;
				ctx.ask("saveFile", [
					`thing-tracker-backup-${name}.json`,
					JSON.stringify(backup, null, 2),
					"backup",
				]);
			},
		},
		saveFileReplyOk(draft, [kind], ctx) {
			if (kind !== "backup") {
				toast(draft, ctx, "Shared", "The pack is ready to send.");
				return;
			}
			const times = this.events.map((e) => e.actualAt);
			const range =
				times.length === 0
					? ""
					: `${formatDate(Math.min(...times), this.tz, { weekday: false, now: 0 })} – ${formatDate(Math.max(...times), this.tz, { weekday: false, now: 0 })}`;
			draft.backup.lastAt = this.now;
			draft.backup.dismissedAt = 0;
			draft.backup.rangeText = range;
			toast(draft, ctx, "Backup ready", "");
		},
		saveFileReplyError(draft, [error], ctx) {
			toast(draft, ctx, "Export failed", String(error?.message ?? error), { kind: "error" });
		},
		saveFileHandlerNotFound(draft, _args, ctx) {
			toast(draft, ctx, "Export failed", "This page can't save files.", { kind: "error" });
		},
		// Imports: a file, pasted text or a bundle, previewed before anything changes.
		setImportMode: {
			args: [t.string()],
			run(draft, [mode]) {
				if (mode === "merge" || mode === "replace") draft.importMode = mode;
			},
		},
		setImportText: {
			args: [t.string()],
			run(draft, [text]) {
				draft.importText = text;
			},
		},
		previewImport: {
			args: [],
			run(draft, _args, ctx) {
				openImport(draft, ctx, "", this.importText);
			},
		},
		chooseFile: {
			args: [],
			emits: { ask: ["readText"] },
			run(_draft, _args, ctx) {
				const file = ctx.event?.target?.files?.[0];
				if (file !== undefined) ctx.ask("readText", [file]);
			},
		},
		readTextReplyOk(draft, [text], ctx) {
			openImport(draft, ctx, "", String(text));
		},
		readTextReplyError(draft, [error], ctx) {
			toast(draft, ctx, "Couldn't read that file", String(error?.message ?? error), {
				kind: "error",
			});
		},
		readTextHandlerNotFound() {},
		addBundle: {
			args: [t.string()],
			run(draft, [id], ctx) {
				const bundle = BUNDLES.find((b) => b.id === id);
				if (bundle === undefined) return;
				draft.importMode = "merge";
				openImport(draft, ctx, bundle.title, JSON.stringify(bundle.pack));
			},
		},
		setOverwrite: {
			args: [t.boolean()],
			run(draft, [overwrite]) {
				draft.overwrite = overwrite;
			},
		},
		cancelImport: {
			args: [],
			run(draft) {
				draft.showPreview = false;
				draft.importSource = "";
			},
		},
		confirmImport: {
			args: [],
			run(draft, _args, ctx) {
				const plan = this.plan;
				draft.showPreview = false;
				draft.importSource = "";
				if (plan === null || plan.isNoop) return;
				const C = scopeOf(this).components;
				const next = applyPlan(plan, this.snapshot());
				const known = new Set(next.things.map((x) => x.id));
				draft.things = next.things.map((x) => thingFrom(C, x));
				draft.groups = next.groups.map((g, i) =>
					tagFrom(C, { ...g, thingIds: g.thingIds.filter((id) => known.has(id)) }, i),
				);
				draft.events = next.events.filter((e) => known.has(e.thingId)).map(eventFrom);
				draft.importText = "";
				toast(draft, ctx, "Imported", importedText(plan));
				refresh(this, draft);
			},
		},
	},
});
// The event editor on entry id.
const openEntry = (self, draft, id) => {
	const e = self.events.find((x) => x.id === id);
	if (e === undefined) return;
	const thing = self.things.find((x) => x.id === e.thingId);
	const C = scopeOf(self).components;
	const ids = [
		...new Set([
			...(thing?.measurements.map((r) => r.measurementId) ?? []),
			...e.measurements.map((m) => m.measurementId),
		]),
	];
	const values = ids.flatMap((mid) => {
		const m = findMeasurement(MEASUREMENTS, mid);
		if (m === undefined) return [];
		const base = e.measurements.find((x) => x.measurementId === mid)?.value ?? 0;
		const unit = thing?.measurements.find((r) => r.measurementId === mid)?.unit;
		return [makePrompt(C, m, unit, base, measurementHistory(self.events, e.thingId, mid), true)];
	});
	draft.listContext = null;
	draft.panel = C.EventEditor({
		mode: "edit",
		eventId: e.id,
		thingId: e.thingId,
		heading: thing === undefined ? "Entry" : `${thing.emoji} ${thing.title}`,
		subtitle: `Recorded ${formatRelative(e.recordedAt, self.now, self.tz)}`,
		recordedAt: e.recordedAt,
		when: toDatetimeLocal(e.actualAt, self.tz),
		tz: self.tz,
		notes: e.notes,
		values,
	});
};
const openTagEditor = (self, draft, tag) => {
	const C = scopeOf(self).components;
	const members = [...self.things]
		.sort((a, b) => a.title.localeCompare(b.title))
		.map((thing) => ({
			id: thing.id,
			emoji: thing.emoji,
			title: thing.title,
			checked: tag?.thingIds.includes(thing.id) ?? false,
		}));
	draft.panel = C.TagEditor({
		mode: tag === null ? "create" : "edit",
		tagId: tag?.id ?? "",
		emoji: tag?.emoji ?? "",
		title: tag?.title ?? "",
		members,
	});
};
const logEvent = (self, draft, ctx, thing, measurements) => {
	const id = newId(draft, "event");
	draft.events.push({
		id,
		thingId: thing.id,
		recordedAt: self.now,
		actualAt: self.now,
		measurements,
		notes: "",
	});
	const text =
		measurements.length === 0
			? `Logged at ${formatTime(self.now, self.tz)}`
			: `${measurements
					.map((v) => formatMeasurement(findMeasurement(MEASUREMENTS, v.measurementId), v.value))
					.join(" · ")} at ${formatTime(self.now, self.tz)}`;
	toast(draft, ctx, `${thing.emoji} ${thing.title}`, text, { eventId: id, kind: "logged" });
	refresh(self, draft);
};

function trackView() {
	return $if(
		field("isTrack"),
		div(
			{},
			$if(
				field("hasThings"),
				div(
					{},
					div(
						{ class: `${STICKY} flex items-center gap-2` },
						div(
							{ class: "relative flex-1" },
							span({ class: `absolute top-1/2 left-2.5 -translate-y-1/2 text-sm ${MUTED}` }, "⌕"),
							input({
								type: "search",
								class: "input input-sm w-full pl-8",
								placeholder: "Search things…",
								"aria-label": "Search things",
								value: field("query"),
								"@on.input": send("setQuery", targetValue()),
							}),
						),
						button(
							{
								class: `${ICON_TOGGLE} border-base-300 ${MUTED}`,
								"aria-label": field("collapseLabel"),
								title: field("collapseLabel"),
								"@on.click": send("toggleAllSections"),
							},
							field("collapseIcon"),
						),
						button(
							{
								class: field("compactClass"),
								"aria-label": field("compactLabel"),
								title: field("compactLabel"),
								"aria-pressed": $if(field("compact"), "true", "false"),
								"@on.click": send("toggleCompact"),
							},
							"▦",
						),
					),
					$if(
						field("backupDue"),
						div(
							{ class: BANNER },
							p({ class: "font-medium" }, field("backupTitle")),
							p({ class: `mt-0.5 ${MUTED}` }, field("backupText")),
							div(
								{ class: "mt-1 flex gap-3" },
								button({ class: LINK, "@on.click": send("backupNow") }, "Back up now"),
								button({ class: LINK, "@on.click": send("backupLater") }, "Later"),
							),
						),
						"",
					),
					$if(
						field("noMatches"),
						div(
							{ class: "space-y-3 px-4 py-10 text-center" },
							p({ class: `text-sm ${MUTED}` }, field("noMatchText")),
							button(
								{ class: "btn btn-primary btn-sm", "@on.click": send("newThingFromQuery") },
								field("createText"),
							),
						),
						div({ class: "pb-4" }, pushView(field("gridView"), renderEach(field("sections")))),
					),
				),
				div(
					{ class: "flex flex-col items-center gap-6 px-6 py-16 text-center" },
					div({ class: "text-5xl" }, "⚡"),
					div(
						{ class: "space-y-1.5" },
						h1({ class: "text-lg font-semibold" }, "Nothing to track yet"),
						p(
							{ class: `max-w-xs text-sm ${MUTED}` },
							"Start from a ready-made bundle, or add your own thing. Either way, one tap logs it.",
						),
					),
					div(
						{ class: "flex w-full max-w-xs flex-col gap-2" },
						button(
							{ class: "btn btn-primary", "@on.click": send("browseBundles") },
							"Browse bundles",
						),
						button(
							{ class: "btn btn-outline", "@on.click": send("newThing", "") },
							"Create a thing",
						),
					),
				),
			),
		),
		"",
	);
}

function insightsView() {
	return $if(
		field("isInsights"),
		div(
			{},
			div(
				{ class: `${STICKY} space-y-2` },
				div(
					{ class: "flex items-center gap-2" },
					div(
						{ class: `${SEG} flex-1`, role: "group", "aria-label": "Granularity" },
						each(
							field("granularityButtons"),
							button(
								{
									class: field("cls"),
									value: field("value"),
									"@on.click": send("setGranularity", targetValue()),
								},
								field("text"),
							),
						),
					),
					button(
						{
							class: `size-9 rounded-md border border-base-300 ${MUTED}`,
							"aria-label": "All entries",
							title: "All entries",
							"@on.click": send("openAllEntries"),
						},
						"☰",
					),
				),
				$if(
					field("hasUsedGroups"),
					div(
						{ class: "-mx-1 flex gap-1.5 overflow-x-auto px-1" },
						button({ class: field("allChipClass"), "@on.click": send("clearGroupFilter") }, "All"),
						each(
							field("groups"),
							button(
								{ class: lookupBind("chip"), "@on.click": send("setGroupFilter", sourceKey()) },
								field("title"),
							),
							"usedGroups",
						),
					),
					"",
				),
			),
			$if(
				field("noEvents"),
				div(
					{ class: "flex flex-col items-center gap-3 px-6 py-16 text-center" },
					div({ class: "text-4xl" }, "🗓️"),
					p(
						{ class: `text-sm ${MUTED}` },
						"Nothing logged yet. Entries show up here grouped by day, week or month.",
					),
				),
				div(renderEach(field("buckets"))),
			),
		),
		"",
	);
}

function searchBox(placeholder) {
	return input({
		type: "search",
		class: "input input-sm mb-3 w-full",
		placeholder,
		"aria-label": placeholder,
		value: field("manageQuery"),
		"@on.input": send("setManageQuery", targetValue()),
	});
}
function manageView() {
	return $if(
		field("isManage"),
		div(
			{},
			div(
				{ class: STICKY },
				div(
					{ class: SEG, role: "tablist" },
					each(
						field("manageTabs"),
						button(
							{
								class: field("cls"),
								role: "tab",
								value: field("id"),
								"@on.click": send("setManageTab", targetValue()),
							},
							field("text"),
						),
					),
				),
			),
			$if(
				field("isThingsTab"),
				div(
					{ class: "p-4" },
					button(
						{ class: "btn btn-primary mb-3 w-full", "@on.click": send("newThing", "") },
						"＋ New thing",
					),
					$if(
						field("thingsEmpty"),
						p({ class: `text-sm ${MUTED}` }, "No things yet. Add one, or load a bundle."),
						div(
							searchBox("Search things…"),
							ul(
								{ class: "divide-y divide-base-300/60" },
								renderEach(field("things"), "manageThings"),
							),
						),
					),
				),
				"",
			),
			$if(
				field("isGroupsTab"),
				div(
					{ class: "p-4" },
					button(
						{ class: "btn btn-primary mb-3 w-full", "@on.click": send("newTag") },
						"＋ New tag",
					),
					searchBox("Search tags…"),
					p(
						{ class: `mb-3 text-xs ${MUTED}` },
						"Tags are yours alone — they organise your things and are what you share. Someone importing your tags can file the same things however they like.",
					),
					$if(
						field("groupsEmpty"),
						p(
							{ class: `text-sm ${MUTED}` },
							"No tags yet. Things without tags still show up under “Ungrouped”.",
						),
						ul(
							{ class: "divide-y divide-base-300/60" },
							renderEach(field("groups"), "manageGroups"),
						),
					),
				),
				"",
			),
			$if(
				field("isUnitsTab"),
				div(
					{ class: "p-4" },
					p(
						{ class: `mb-3 text-xs ${MUTED}` },
						"Quantities a thing can record. Metric and imperial units sit inside the same measurement, so values are stored once and everyone reads them in whichever unit they think in.",
					),
					searchBox("Search measurements…"),
					ul(
						{ class: "divide-y divide-base-300/60" },
						each(
							field("unitRows"),
							li(
								{ class: "py-2.5" },
								div(
									{ class: "flex items-center gap-3" },
									span({ class: "emoji text-xl" }, field("emoji")),
									span({ class: "flex-1 text-sm font-medium" }, field("name")),
									span({ class: `text-xs ${MUTED}` }, field("usage")),
								),
								div({ class: `pl-8 text-xs ${MUTED}` }, field("units")),
							),
						),
					),
				),
				"",
			),
			$if(
				field("isBundlesTab"),
				div(
					{ class: "p-4" },
					p(
						{ class: `mb-3 text-xs ${MUTED}` },
						"Ready-made sets of things to track. Everyone who loads a bundle gets the same identifiers, so data recorded against it can be compared later.",
					),
					searchBox("Search bundles…"),
					div(
						{ class: "flex flex-col gap-2" },
						each(
							field("bundleCards"),
							div(
								{
									class:
										"flex items-start gap-3 rounded-xl border border-base-300/60 bg-base-100 p-3",
								},
								span({ class: "emoji text-2xl" }, field("emoji")),
								div(
									{ class: "min-w-0 flex-1" },
									h3(
										{ class: "flex items-baseline gap-2 truncate text-sm font-medium" },
										field("title"),
										$if(field("added"), span({ class: `text-[0.6875rem] ${MUTED}` }, "added"), ""),
									),
									p({ class: `text-xs ${MUTED}` }, field("description")),
									p({ class: "text-[0.6875rem] opacity-50" }, field("counts")),
								),
								button(
									{
										class: field("cls"),
										value: field("id"),
										"@on.click": send("addBundle", targetValue()),
									},
									field("action"),
								),
							),
						),
					),
				),
				"",
			),
			$if(field("isDataTab"), dataView(), ""),
		),
		"",
	);
}
function dataView() {
	const heading = (text) => h2({ class: "text-sm font-medium" }, text);
	const hr = div({ class: "h-px w-full bg-base-300" });
	return div(
		{ class: "space-y-5 p-4" },
		section(
			{ class: "space-y-1" },
			heading("On this device"),
			p({ class: "text-sm" }, field("countsText")),
			p(
				{ class: `text-xs ${MUTED}` },
				"Everything lives in this browser. No account, no server — which also means a backup is the only copy that survives clearing site data.",
			),
		),
		hr,
		section(
			{ class: "space-y-2" },
			heading("Backup"),
			p(
				{ class: `text-xs ${MUTED}` },
				"A single JSON file with every thing, tag and entry — for safekeeping or for analysing elsewhere.",
			),
			button(
				{ class: "btn btn-primary w-full", "@on.click": send("exportAll") },
				"⤓ Export everything",
			),
			p({ class: `text-xs ${MUTED}` }, field("backupStatus")),
			div(
				{ class: "flex flex-wrap items-center gap-1.5" },
				span({ class: `text-xs ${MUTED}` }, "Remind me every"),
				each(
					field("intervalChips"),
					button(
						{
							class: field("cls"),
							value: field("value"),
							"@on.click": send("setInterval", targetValue()),
						},
						field("text"),
					),
				),
			),
		),
		hr,
		section(
			{ class: "space-y-2" },
			heading("Restore or import"),
			p(
				{ class: `text-xs ${MUTED}` },
				"Open a backup or a shared tag pack. You'll see exactly what changes before anything is written.",
			),
			div(
				{ class: "flex gap-2" },
				each(
					field("modeButtons"),
					button(
						{
							class: field("cls"),
							value: field("value"),
							"@on.click": send("setImportMode", targetValue()),
						},
						field("text"),
					),
				),
			),
			p({ class: `text-xs ${MUTED}` }, field("modeText")),
			label(
				{ class: "btn btn-outline w-full" },
				"⤒ Choose a file",
				input({
					type: "file",
					accept: "application/json,.json",
					class: "hidden",
					"@on.change": send("chooseFile"),
				}),
			),
			textarea({
				class: "textarea w-full font-mono text-xs",
				rows: "3",
				placeholder: "…or paste a backup or tag pack",
				"aria-label": "Paste a file",
				value: field("importText"),
				"@on.input": send("setImportText", targetValue()),
			}),
			button(
				{ class: "btn btn-outline btn-sm w-full", "@on.click": send("previewImport") },
				"Preview import",
			),
		),
	);
}
function importDialog() {
	return div(
		{ class: "absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" },
		div(
			{
				class:
					"grid w-full max-w-md gap-4 rounded-lg border border-base-300 bg-base-100 p-6 shadow-lg",
				role: "dialog",
				"aria-label": "Import preview",
			},
			div(
				{ class: "flex flex-col gap-2" },
				h2({ class: "text-lg leading-none font-semibold" }, field("importTitle")),
				p({ class: `text-sm ${MUTED}` }, field("previewDescription")),
			),
			ul(
				{ class: "space-y-1 text-sm" },
				each(field("previewLines"), li("· ", lookupBind("value"))),
			),
			ul(
				{ class: `space-y-1 text-xs ${MUTED}` },
				each(field("previewWarnings"), li("⚠ ", lookupBind("value"))),
			),
			$if(
				field("previewCanOverwrite"),
				label(
					{ class: "flex items-start gap-2 text-sm" },
					input({
						type: "checkbox",
						class: "checkbox checkbox-sm",
						checked: field("overwrite"),
						"@on.change": send("setOverwrite", targetValue()),
					}),
					span(
						{},
						"Update details of things I already have",
						span(
							{ class: `block text-xs ${MUTED}` },
							"Names, emoji and what gets recorded — so ticking this is how an updated bundle adds a measurement to a thing you already have. Off by default: your own edits win. Ids never change either way, so entries you've already recorded stay attached.",
						),
					),
				),
				"",
			),
			div(
				{ class: "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" },
				button({ class: "btn btn-outline btn-sm", "@on.click": send("cancelImport") }, "Cancel"),
				button(
					{
						class: field("confirmImportClass"),
						disabled: field("previewNoop"),
						"@on.click": send("confirmImport"),
					},
					field("confirmImportLabel"),
				),
			),
		),
	);
}

// An app with the things and tags of bundles (slugs) and events, each { thing (id), ago
// (ms before now), measurements, notes }, with what it derives already worked out.
export const trackerApp = (C, { now, tz = 0, bundles = [], events = [], ...rest }) => {
	const things = new Map();
	const groups = new Map();
	for (const slug of bundles) {
		const { pack } = BUNDLES.find((b) => b.id === slug);
		for (const t of pack.things) things.set(t.id, thingFrom(C, t));
		for (const g of pack.groups) groups.set(g.id, tagFrom(C, g, groups.size));
	}
	const made = events.map((e, i) => ({
		id: `event-${i + 1}`,
		thingId: e.thing,
		recordedAt: now - (e.recordedAgo ?? e.ago),
		actualAt: now - e.ago,
		measurements: e.measurements ?? [],
		notes: e.notes ?? "",
	}));
	const visible = [...things.values()].filter((t) => !t.archived);
	const app = C.TrackerApp({
		now,
		tz,
		things: [...things.values()],
		groups: [...groups.values()],
		events: made,
		order: rankThings(visible, usageOf(made)),
		nextId: made.length + 1,
		...rest,
	});
	refresh(app, app); // Not frozen yet: made by make, not by a task.
	return app;
};

export const trackerComponents = {
	TrackerApp,
	Thing,
	Tag,
	Section,
	Bucket,
	Prompt,
	EmojiPicker,
	MeasurementWizard,
	EventEditor,
	ThingEditor,
	TagEditor,
	EntryList,
};
export { UNGROUPED };
