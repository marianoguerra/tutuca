// A JSON Schema viewer. One component per kind of schema: fromSchema reads the kind once, on
// the way in, and no view branches on it. Every node has two readings: main, the schema read
// as a data dictionary, and format, the schema read as the keywords it is written with.
// SchemaRoot pushes one of them onto the view stack; nodes without a format view keep main.
//
// enum and const carry arbitrary JSON, which has no schema shape, so they hold JSON components.

import {
	$if,
	button,
	component,
	each,
	field,
	isComponent,
	lookupBind,
	pushView,
	render,
	renderEach,
	renderIt,
	send,
	specOf,
	t,
	tag,
} from "../../src/tutuca.js";
import { VALUE_NAMES } from "../json/index.js";

const { div, header, section, span } = tag;

export const SCHEMA_NAMES = [
	"SchemaObject",
	"SchemaArray",
	"SchemaString",
	"SchemaNumber",
	"SchemaInteger",
	"SchemaBoolean",
	"SchemaNull",
	"SchemaUnion",
	"SchemaEnum",
	"SchemaConst",
	"SchemaRef",
	"SchemaAllOf",
	"SchemaAnyOf",
	"SchemaOneOf",
	"SchemaNot",
	"SchemaAny",
	"SchemaNever",
];
export const DEFAULT_PER_PAGE = 50;

const LINE = "flex items-baseline min-w-0 py-px";
const BODY = "ml-2 pl-3 border-l border-base-300";
const BADGE = "badge badge-xs px-1 badge-soft";
const KIND = "text-info kind";
const MUTED = "opacity-60";
const NOTHING = "opacity-50 italic py-px";
const DISCLOSURE = "btn btn-xs btn-ghost h-5 min-h-0 gap-0 pl-1 pr-0 font-mono disclosure";
const PAGER_BTN = "btn btn-xs btn-ghost h-5 min-h-0 px-1";
const HINT = "click: this node / ctrl: its siblings / ctrl+alt: everything below";
// A keyword the schema writes as a number, kept as its text: "" when the schema has none.
const NUMERIC = /^(-?\d+(\.\d+)?([eE][-+]?\d+)?)?$/;
const isFiniteText = (text) => text === "" || Number.isFinite(Number(text));
const numText = () => t.string().match(NUMERIC).where(isFiniteText);
const schemaNode = () => t.component(SCHEMA_NAMES);
const notesFields = (t) => ({ title: t.string(), description: t.string() });

// -- opening and closing ------------------------------------------------------

// The fields holding the schema nodes below each kind. Enum and const hold JSON, not schemas.
const KIDS = {
	SchemaRoot: ["node"],
	SchemaObject: ["properties", "additional"],
	SchemaProperty: ["schema"],
	SchemaArray: ["items"],
	SchemaAllOf: ["branches"],
	SchemaAnyOf: ["branches"],
	SchemaOneOf: ["branches"],
	SchemaNot: ["schema"],
};
const kidsOf = (v) => (KIDS[specOf(v)?.name] ?? []).flatMap((k) => v[k]).filter(isComponent);
const isOpenable = (v) => isComponent(v) && "open" in specOf(v).fields;
// The nearest openable nodes below v; a property is see-through, as it owns no open state.
const openablesBelow = (v) =>
	kidsOf(v).flatMap((k) =>
		specOf(k).name === "SchemaProperty" ? openablesBelow(k) : isOpenable(k) ? [k] : [],
	);
// Works on drafts too: it only reads specs and sets open.
const openDeep = (v, open) => {
	if (isOpenable(v)) v.open = open;
	for (const k of kidsOf(v)) openDeep(k, open);
};
const nodesBelow = (v) => [v, ...kidsOf(v).flatMap(nodesBelow)];
// The open state of v and every node below it, depth first.
export const allOpen = (v) =>
	nodesBelow(v)
		.filter(isOpenable)
		.map((n) => n.open);

const setOpenDeep = {
	args: [t.boolean()],
	run(draft, [open]) {
		openDeep(draft, open);
	},
};
// Raised by a ctrl click below: the nearest container opens or closes all its nodes.
const openSiblings = {
	args: [t.boolean()],
	run(draft, [open], ctx) {
		for (const k of openablesBelow(draft)) k.open = open;
		ctx.stopNext();
	},
};
// The messages of a node with an open state.
const openableMessages = {
	toggle: {
		args: [],
		emits: { notify: ["openSiblings"] },
		run(draft, _args, ctx) {
			const e = ctx.event;
			const ctrl = Boolean(e?.ctrlKey || e?.metaKey);
			const open = !this.open;
			if (ctrl && e.altKey) openDeep(draft, open);
			else if (ctrl) ctx.notify("openSiblings", [open]);
			else draft.open = open;
		},
	},
	setOpen: {
		args: [t.boolean()],
		post: (_prev, next, [open]) => next.open === open,
		run(draft, [open]) {
			draft.open = open;
		},
	},
	setOpenDeep,
};

// -- the pager ----------------------------------------------------------------

// One page of a node's items. total is a field: a node's items never change once built.
export const SchemaPager = component({
	name: "SchemaPager",
	fields: (t) => ({
		total: t.number().int().min(0),
		perPage: t.number(DEFAULT_PER_PAGE).int().min(1),
		page: t.number().int().min(0),
		settings: t.boolean(),
	}),
	invariants: {
		pageInRange() {
			return this.page <= this.lastPage;
		},
	},
	methods: {
		get lastPage() {
			return Math.max(0, Math.ceil(this.total / this.perPage) - 1);
		},
		// Labels count from one.
		get first() {
			return this.page * this.perPage + 1;
		},
		get last() {
			return Math.min(this.total, (this.page + 1) * this.perPage);
		},
		get isMany() {
			return this.total > this.perPage;
		},
		get atFirst() {
			return this.page <= 0;
		},
		get atLast() {
			return this.page >= this.lastPage;
		},
		shows(key) {
			return key >= this.page * this.perPage && key < (this.page + 1) * this.perPage;
		},
	},
	view: $if(
		field("isMany"),
		div(
			{ class: "flex items-baseline gap-1 min-w-0 py-px opacity-70 pager" },
			span(
				{ class: "join shrink-0" },
				...[
					["first", "«", "atFirst", "First page"],
					["prev", "‹", "atFirst", "Previous page"],
					["next", "›", "atLast", "Next page"],
					["last", "»", "atLast", "Last page"],
				].map(([name, text, off, title]) =>
					button(
						{
							class: `${PAGER_BTN} join-item ${name}`,
							title,
							disabled: field(off),
							"@on.click": send(name),
						},
						text,
					),
				),
			),
			span({ class: "shrink-0 range" }, field("first"), "–", field("last"), " of ", field("total")),
			button(
				{
					class: `${PAGER_BTN} settings-toggle`,
					title: "Items per page",
					"@on.click": send("toggleSettings"),
				},
				"⚙",
			),
			$if(
				field("settings"),
				span(
					{ class: "join per-page" },
					...[10, 25, 50, 100].map((n) =>
						button(
							{ class: `${PAGER_BTN} join-item size`, "@on.click": send("setPerPage", n) },
							String(n),
						),
					),
					button({ class: `${PAGER_BTN} join-item all`, "@on.click": send("showAll") }, "all"),
				),
				null,
			),
		),
		null,
	),
	on: {
		first: {
			args: [],
			post: (_prev, next) => next.page === 0,
			run(draft) {
				draft.page = 0;
			},
		},
		prev: {
			args: [],
			run(draft) {
				draft.page = Math.max(0, this.page - 1);
			},
		},
		next: {
			args: [],
			run(draft) {
				draft.page = Math.min(this.lastPage, this.page + 1);
			},
		},
		last: {
			args: [],
			post: (_prev, next) => next.atLast,
			run(draft) {
				draft.page = this.lastPage;
			},
		},
		// Keeps the first item of the page in view.
		setPerPage: {
			args: [t.number().int().min(1)],
			post: (_prev, next, [n]) => next.perPage === n,
			run(draft, [n]) {
				const first = this.page * this.perPage;
				draft.perPage = n;
				draft.page = Math.floor(first / n);
			},
		},
		showAll: {
			args: [],
			post: (_prev, next) => !next.isMany,
			run(draft) {
				draft.perPage = Math.max(1, this.total);
				draft.page = 0;
			},
		},
		toggleSettings: {
			args: [],
			run(draft) {
				draft.settings = !this.settings;
			},
		},
	},
});

// The pager for total items, or null when they fit in one page.
export const pagerFor = (C, total, perPage) =>
	total <= perPage ? null : C.SchemaPager({ total, perPage: Math.max(1, perPage) });
// Loop state for a paged list: only the items of the pager's page.
const paged = {
	filter(key) {
		return this.pager === null || this.pager.shows(key);
	},
};

// -- view parts -----------------------------------------------------------------

const tri = span({ class: `${MUTED} mr-1` }, $if(field("open"), "▾", "▸"));
const disclosure = (caption, captionClass = `${MUTED} caption`) =>
	button(
		{ class: DISCLOSURE, title: HINT, "@on.click": send("toggle") },
		tri,
		span({ class: captionClass }, caption),
	);
// A keyword and its value, in the format view; nothing when the value is "".
const row = (label, name) =>
	$if(
		field(name),
		div(
			{ class: "flex items-baseline gap-1 min-w-0 py-px row" },
			span({ class: "text-secondary label" }, label),
			span({ class: MUTED }, ":"),
			span(
				{
					class:
						"overflow-hidden text-ellipsis whitespace-pre inline-block align-bottom max-w-2xl text-success value",
					title: field(name),
				},
				field(name),
			),
		),
		null,
	);
const notes = [row("title", "title"), row("description", "description")];
const badge = (cls, text, show = text) =>
	$if(field(show), span({ class: `${BADGE} ${cls}`, title: field(text) }, field(text)), null);
const semanticNote = $if(
	field("description"),
	span(
		{
			class: "ml-1 opacity-50 truncate inline-block align-bottom max-w-xl note",
			title: field("description"),
		},
		field("description"),
	),
	null,
);
// A leaf in the format view: its kind, then its keywords below it.
const leafFormat = (cls, kind, ...rows) =>
	div({ class: cls }, div({ class: KIND }, kind), div({ class: BODY }, ...notes, ...rows));
const pagerSlot = $if(field("pager"), render(field("pager")), null);

const putNotes = (v, out) => {
	if (v.title !== "") out.title = v.title;
	if (v.description !== "") out.description = v.description;
	return out;
};
const putNumbers = (v, out, keys) => {
	for (const [key, name] of keys) if (v[name] !== "") out[key] = Number(v[name]);
	return out;
};

// -- the root ---------------------------------------------------------------------

const viewButton = (view, label) =>
	button(
		{
			class: $if(
				field(view === "format" ? "isFormat" : "isMain"),
				`btn btn-xs btn-ghost join-item btn-active view-${label}`,
				`btn btn-xs btn-ghost join-item view-${label}`,
			),
			"aria-pressed": field(view === "format" ? "isFormat" : "isMain"),
			"@on.click": send("setView", view),
		},
		label,
	);

// The entry point of a schema tree: a toolbar and one node.
export const SchemaRoot = component({
	name: "SchemaRoot",
	fields: (t) => ({ node: schemaNode(), view: t.enum("main", "format") }),
	methods: {
		toSchema() {
			return this.node.toSchema();
		},
		get isFormat() {
			return this.view === "format";
		},
		get isMain() {
			return this.view === "main";
		},
	},
	view: section(
		{
			class: "font-mono text-xs leading-5 bg-base-100 text-base-content p-3 rounded schema-root",
		},
		header(
			{ class: "flex gap-1 items-center pb-2 mb-2 border-b border-base-300" },
			span(
				{ class: "join mr-2", role: "group", "aria-label": "Reading" },
				viewButton("main", "semantic"),
				viewButton("format", "format"),
			),
			button(
				{ class: "btn btn-xs btn-ghost expand-all", "@on.click": send("setOpenDeep", true) },
				"expand all",
			),
			button(
				{ class: "btn btn-xs btn-ghost collapse-all", "@on.click": send("setOpenDeep", false) },
				"collapse all",
			),
		),
		pushView(field("view"), div({ class: "schema-tree" }, render(field("node")))),
	),
	on: {
		setView: {
			args: [t.enum("main", "format")],
			post: (_prev, next, [view]) => next.view === view,
			run(draft, [view]) {
				draft.view = view;
			},
		},
		setOpenDeep: {
			...setOpenDeep,
			post: (_prev, next, [open]) => allOpen(next).every((o) => o === open),
		},
		openSiblings,
	},
});

// -- objects ------------------------------------------------------------------------

// type: object.
export const SchemaObject = component({
	name: "SchemaObject",
	fields: (t) => ({
		...notesFields(t),
		properties: t.array(t.component("SchemaProperty")),
		additional: t.option(schemaNode()), // What additionalProperties allows, if it says.
		open: t.boolean(true),
		pager: t.option(t.component("SchemaPager")),
	}),
	methods: {
		get caption() {
			return `object (${this.properties.length})`;
		},
		toSchema() {
			const out = putNotes(this, { type: "object" });
			// A repeated name is one key in JSON: the last property with it wins, required too.
			const byName = new Map(this.properties.map((p) => [p.name, p]));
			out.properties = Object.fromEntries(
				[...byName].map(([name, p]) => [name, p.schema.toSchema()]),
			);
			const required = [...byName.values()].filter((p) => p.required).map((p) => p.name);
			if (required.length > 0) out.required = required;
			if (this.additional !== null) out.additionalProperties = this.additional.toSchema();
			return out;
		},
	},
	loops: { page: paged },
	views: {
		main: span(
			{ class: "schema-object" },
			span({ class: LINE }, disclosure(field("caption")), semanticNote),
			$if(
				field("open"),
				span(
					{ class: `block ${BODY} body` },
					pagerSlot,
					renderEach(field("properties"), "page"),
					$if(
						field("additional"),
						span(
							{ class: "flex items-baseline gap-1 min-w-0 py-px additional" },
							span({ class: "opacity-50" }, "…and"),
							render(field("additional")),
						),
						null,
					),
				),
				null,
			),
		),
		format: div(
			{ class: "schema-object" },
			div({ class: LINE }, disclosure(field("caption"))),
			$if(
				field("open"),
				div(
					{ class: `${BODY} body` },
					...notes,
					pagerSlot,
					renderEach(field("properties"), "page"),
					$if(
						field("additional"),
						div(
							{ class: "mt-2 additional" },
							div({ class: "text-secondary" }, "additionalProperties"),
							div({ class: BODY }, render(field("additional"))),
						),
						null,
					),
				),
				null,
			),
		),
	},
	on: { ...openableMessages, openSiblings },
});

// One named property of an object. It owns no open state: messages go to its schema.
export const SchemaProperty = component({
	name: "SchemaProperty",
	fields: (t) => ({ name: t.string(), required: t.boolean(), schema: schemaNode() }),
	methods: {
		get mark() {
			return this.required ? "required" : "optional";
		},
	},
	views: {
		main: span(
			{ class: "block schema-property" },
			span(
				{ class: "flex items-baseline gap-1 min-w-0 py-px" },
				span(
					{
						class: "truncate inline-block align-bottom max-w-xs text-secondary name",
						title: field("name"),
					},
					field("name"),
				),
				$if(field("required"), span({ class: "text-error mark", title: "required" }, "*"), null),
				span({ class: MUTED }, ":"),
				render(field("schema")),
			),
		),
		format: div(
			{ class: "schema-property" },
			div(
				{ class: "flex items-baseline gap-1 min-w-0 py-px" },
				span(
					{
						class: "truncate inline-block align-bottom max-w-xs text-secondary name",
						title: field("name"),
					},
					field("name"),
				),
				span({ class: MUTED }, ":"),
				span({ class: `${BADGE} mark` }, field("mark")),
			),
			div({ class: BODY }, render(field("schema"))),
		),
	},
	on: {
		setOpen: {
			args: [t.boolean()],
			run(draft, [open]) {
				if (isOpenable(draft.schema)) draft.schema.open = open;
			},
		},
		setOpenDeep,
		// Not answered here: it bubbles on to the object.
		openSiblings: { args: [t.boolean()], run() {} },
	},
});

// -- arrays -------------------------------------------------------------------------

// type: array.
export const SchemaArray = component({
	name: "SchemaArray",
	fields: (t) => ({
		...notesFields(t),
		items: t.option(schemaNode()), // What every element must be, if it says.
		minItems: numText(),
		maxItems: numText(),
		open: t.boolean(true),
	}),
	methods: {
		get minLabel() {
			return `≥ ${this.minItems}`;
		},
		get maxLabel() {
			return `≤ ${this.maxItems}`;
		},
		toSchema() {
			const out = putNotes(this, { type: "array" });
			if (this.items !== null) out.items = this.items.toSchema();
			return putNumbers(this, out, [
				["minItems", "minItems"],
				["maxItems", "maxItems"],
			]);
		},
	},
	views: {
		main: span(
			{ class: "schema-array" },
			span(
				{ class: "flex items-baseline gap-1 min-w-0 py-px" },
				disclosure("array of", "text-info caption"),
				badge("c-min", "minLabel", "minItems"),
				badge("c-max", "maxLabel", "maxItems"),
			),
			$if(
				field("open"),
				span(
					{ class: `block ${BODY}` },
					$if(field("items"), render(field("items")), span({ class: NOTHING }, "anything")),
				),
				null,
			),
		),
		format: div(
			{ class: "schema-array" },
			div({ class: LINE }, disclosure("array")),
			$if(
				field("open"),
				div(
					{ class: `${BODY} body` },
					...notes,
					row("minItems", "minItems"),
					row("maxItems", "maxItems"),
					$if(
						field("items"),
						div(
							{ class: "mt-2 items" },
							div({ class: "text-secondary" }, "items"),
							div({ class: BODY }, render(field("items"))),
						),
						null,
					),
				),
				null,
			),
		),
	},
	on: { ...openableMessages, openSiblings },
});

// -- scalars --------------------------------------------------------------------------

export const SchemaString = component({
	name: "SchemaString",
	fields: (t) => ({
		...notesFields(t),
		format: t.string(),
		pattern: t.string(),
		minLength: numText(),
		maxLength: numText(),
	}),
	methods: {
		get minLabel() {
			return `≥ ${this.minLength}`;
		},
		get maxLabel() {
			return `≤ ${this.maxLength}`;
		},
		toSchema() {
			const out = putNotes(this, { type: "string" });
			if (this.format !== "") out.format = this.format;
			if (this.pattern !== "") out.pattern = this.pattern;
			return putNumbers(this, out, [
				["minLength", "minLength"],
				["maxLength", "maxLength"],
			]);
		},
	},
	views: {
		main: span(
			{ class: "inline-flex items-center gap-1 schema-string" },
			span({ class: KIND }, "string"),
			badge("c-format", "format"),
			badge("c-pattern", "pattern"),
			badge("c-min", "minLabel", "minLength"),
			badge("c-max", "maxLabel", "maxLength"),
		),
		format: leafFormat(
			"schema-string",
			"string",
			row("format", "format"),
			row("pattern", "pattern"),
			row("minLength", "minLength"),
			row("maxLength", "maxLength"),
		),
	},
});

// number and integer are different types, so different components with the same shape.
const numeric = (name, kind) =>
	component({
		name,
		fields: (t) => ({
			...notesFields(t),
			minimum: numText(),
			maximum: numText(),
			multipleOf: numText(),
		}),
		methods: {
			get minLabel() {
				return `≥ ${this.minimum}`;
			},
			get maxLabel() {
				return `≤ ${this.maximum}`;
			},
			get stepLabel() {
				return `× ${this.multipleOf}`;
			},
			toSchema() {
				return putNumbers(this, putNotes(this, { type: kind }), [
					["minimum", "minimum"],
					["maximum", "maximum"],
					["multipleOf", "multipleOf"],
				]);
			},
		},
		views: {
			main: span(
				{ class: `inline-flex items-center gap-1 schema-${kind}` },
				span({ class: KIND }, kind),
				badge("c-min", "minLabel", "minimum"),
				badge("c-max", "maxLabel", "maximum"),
				badge("c-step", "stepLabel", "multipleOf"),
			),
			format: leafFormat(
				`schema-${kind}`,
				kind,
				row("minimum", "minimum"),
				row("maximum", "maximum"),
				row("multipleOf", "multipleOf"),
			),
		},
	});
export const SchemaNumber = numeric("SchemaNumber", "number");
export const SchemaInteger = numeric("SchemaInteger", "integer");

// A type with nothing to it but its name.
const bare = (name, kind) =>
	component({
		name,
		fields: notesFields,
		methods: {
			toSchema() {
				return putNotes(this, { type: kind });
			},
		},
		views: {
			main: span({ class: `text-info schema-${kind}` }, kind),
			format: leafFormat(`schema-${kind}`, kind),
		},
	});
export const SchemaBoolean = bare("SchemaBoolean", "boolean");
export const SchemaNull = bare("SchemaNull", "null");

const typeNames = each(
	field("types"),
	span({ class: `${BADGE} text-info type-name` }, lookupBind("value")),
);

// type: ["string", "null"]: several types, any of which will do.
export const SchemaUnion = component({
	name: "SchemaUnion",
	fields: (t) => ({ ...notesFields(t), types: t.array(t.string()) }),
	methods: {
		toSchema() {
			return putNotes(this, { type: [...this.types] });
		},
	},
	views: {
		main: span({ class: "inline-flex items-center flex-wrap gap-1 schema-union" }, typeNames),
		format: div(
			{ class: "schema-union" },
			div(
				{ class: "flex items-baseline gap-1 min-w-0 py-px" },
				span({ class: MUTED }, "one of"),
				typeNames,
			),
			div({ class: BODY }, ...notes),
		),
	},
});

// -- values -------------------------------------------------------------------------

// enum: [...]: a closed set of values, shown as JSON.
export const SchemaEnum = component({
	name: "SchemaEnum",
	fields: (t) => ({
		...notesFields(t),
		values: t.array(t.component(VALUE_NAMES)),
		open: t.boolean(true),
		pager: t.option(t.component("SchemaPager")),
	}),
	methods: {
		get caption() {
			return `enum (${this.values.length})`;
		},
		toSchema() {
			return putNotes(this, { enum: this.values.map((v) => v.toJson()) });
		},
	},
	loops: { page: paged },
	views: {
		main: span(
			{ class: "schema-enum" },
			span({ class: LINE }, disclosure("one of", "text-info caption")),
			$if(
				field("open"),
				span(
					{ class: `flex flex-col ${BODY}` },
					pagerSlot,
					each(field("values"), span({ class: "py-px" }, renderIt()), "page"),
				),
				null,
			),
		),
		format: div(
			{ class: "schema-enum" },
			div({ class: LINE }, disclosure(field("caption"))),
			$if(
				field("open"),
				div(
					{ class: `flex flex-col ${BODY} body` },
					...notes,
					pagerSlot,
					each(field("values"), span({ class: "py-px" }, renderIt()), "page"),
				),
				null,
			),
		),
	},
	on: { ...openableMessages },
});

// const: x, exactly one value.
export const SchemaConst = component({
	name: "SchemaConst",
	fields: (t) => ({ ...notesFields(t), value: t.component(VALUE_NAMES) }),
	methods: {
		toSchema() {
			return putNotes(this, { const: this.value.toJson() });
		},
	},
	views: {
		main: span(
			{ class: "flex items-baseline gap-1 min-w-0 schema-const" },
			span({ class: MUTED }, "="),
			render(field("value")),
		),
		format: div(
			{ class: "schema-const" },
			div(
				{ class: "flex items-baseline gap-1 min-w-0 py-px" },
				span({ class: MUTED }, "const"),
				render(field("value")),
			),
			div({ class: BODY }, ...notes),
		),
	},
});

// $ref: a pointer to a schema declared elsewhere.
export const SchemaRef = component({
	name: "SchemaRef",
	fields: (t) => ({ target: t.string() }),
	methods: {
		toSchema() {
			return { $ref: this.target };
		},
	},
	view: div(
		{ class: "flex items-baseline gap-1 min-w-0 py-px schema-ref" },
		span({ class: MUTED }, "$ref"),
		span(
			{
				class: "truncate inline-block align-bottom max-w-2xl text-warning ref",
				title: field("target"),
			},
			field("target"),
		),
	),
});

// -- combinators ----------------------------------------------------------------------

// allOf, anyOf and oneOf: branches, read as label in main and as key in format.
const combinator = (name, key, label) =>
	component({
		name,
		fields: (t) => ({
			...notesFields(t),
			branches: t.array(schemaNode()),
			open: t.boolean(true),
			pager: t.option(t.component("SchemaPager")),
		}),
		methods: {
			get caption() {
				return `${key} (${this.branches.length})`;
			},
			toSchema() {
				return putNotes(this, { [key]: this.branches.map((b) => b.toSchema()) });
			},
		},
		loops: { page: paged },
		views: {
			main: span(
				{ class: `schema-${key.toLowerCase()}` },
				span({ class: LINE }, disclosure(label, "text-info caption")),
				$if(
					field("open"),
					span({ class: `block ${BODY}` }, pagerSlot, renderEach(field("branches"), "page")),
					null,
				),
			),
			format: div(
				{ class: `schema-${key.toLowerCase()}` },
				div({ class: LINE }, disclosure(field("caption"))),
				$if(
					field("open"),
					div(
						{ class: `${BODY} body` },
						...notes,
						pagerSlot,
						renderEach(field("branches"), "page"),
					),
					null,
				),
			),
		},
		on: { ...openableMessages, openSiblings },
	});
export const SchemaAllOf = combinator("SchemaAllOf", "allOf", "all of");
export const SchemaAnyOf = combinator("SchemaAnyOf", "anyOf", "any of");
export const SchemaOneOf = combinator("SchemaOneOf", "oneOf", "exactly one of");

// not: the one branch must not hold.
export const SchemaNot = component({
	name: "SchemaNot",
	fields: (t) => ({ ...notesFields(t), schema: schemaNode() }),
	methods: {
		toSchema() {
			return putNotes(this, { not: this.schema.toSchema() });
		},
	},
	views: {
		main: span(
			{ class: "flex items-baseline gap-1 min-w-0 schema-not" },
			span({ class: MUTED }, "not"),
			render(field("schema")),
		),
		format: div(
			{ class: "schema-not" },
			div({ class: MUTED }, "not"),
			div({ class: BODY }, ...notes, render(field("schema"))),
		),
	},
	on: { setOpenDeep, openSiblings },
});

// true, or {}: anything is valid.
export const SchemaAny = component({
	name: "SchemaAny",
	methods: {
		toSchema() {
			return {};
		},
	},
	view: div({ class: `${NOTHING} schema-any` }, "anything"),
});

// false: nothing is valid.
export const SchemaNever = component({
	name: "SchemaNever",
	methods: {
		toSchema() {
			return false;
		},
	},
	view: div({ class: `${NOTHING} schema-never` }, "nothing"),
});

export const schemaComponents = {
	SchemaRoot,
	SchemaObject,
	SchemaProperty,
	SchemaArray,
	SchemaString,
	SchemaNumber,
	SchemaInteger,
	SchemaBoolean,
	SchemaNull,
	SchemaUnion,
	SchemaEnum,
	SchemaConst,
	SchemaRef,
	SchemaAllOf,
	SchemaAnyOf,
	SchemaOneOf,
	SchemaNot,
	SchemaAny,
	SchemaNever,
	SchemaPager,
};
