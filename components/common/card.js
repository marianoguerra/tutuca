// The parts of an explainer card (the LLM's, the HTTP exchange's): its classes, a header with a
// badge, labeled inputs, number inputs, removable list items and sections that collapse by
// their titles.
import {
	$if,
	apply,
	canApply,
	DISPLAY_META,
	field,
	renderIt,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { CANVAS_META } from "../canvas/layout.js";

const { button, div, h3, header, input, label, section, span } = tag;

// What a card says of itself (its title, icon and what it's for) and how wide it starts on a
// canvas.
export const metaFor = (title, icon, description, width) => ({
	[DISPLAY_META]: { title, icon, description },
	[CANVAS_META]: { width },
});

export const BADGE = "badge badge-sm badge-soft font-semibold";
export const MONO = "font-mono text-sm";
export const TEXTAREA = "textarea textarea-bordered textarea-sm min-h-24 w-full text-sm";
export const INPUT = "input input-bordered input-sm w-full";
export const FIELD_LABEL = "flex flex-col gap-1 text-xs opacity-80";
export const PART = "text-xs font-semibold opacity-60";
export const SMALL_BUTTON = "btn btn-xs btn-ghost";
// A card's classes, with kind (llm-request, http-response, ...) to find it by.
export const cardClass = (kind) =>
	`${kind} flex flex-col gap-2 rounded-md border border-base-300 bg-base-100 p-3 text-sm`;

// A card's header: its badge and what's beside it.
export const cardHeader = (badge, badgeClass, ...rest) =>
	header(
		{ class: "flex flex-wrap items-center gap-2" },
		span({ class: `${BADGE} ${badgeClass}` }, badge),
		...rest,
	);
export const labeled = (text, control) => label({ class: FIELD_LABEL }, text, control);
// An input for the string field name, sending handler with what's typed.
export const textInput = (ariaLabel, name, handler, cls = "") =>
	input({
		class: `${INPUT} ${cls}`,
		"aria-label": ariaLabel,
		value: field(name),
		"on:input": send(handler, targetValue()),
	});
// A handler setting the string field name.
export const setString = (name) => ({
	args: [t.string()],
	run(next, [value]) {
		next[name] = value;
	},
});

// A number typed in an input, or null when it isn't one (the field then keeps what it had).
export const typedNumber = (text) => {
	const n = Number(text);
	return text.trim() === "" || !Number.isFinite(n) ? null : n;
};
export const numberInput = (ariaLabel, name, handler, cls = "") =>
	input({
		type: "number",
		min: "0",
		step: "any",
		class: `${INPUT} tabular-nums ${cls}`,
		"aria-label": ariaLabel,
		value: field(name),
		"on:input": send(handler, targetValue()),
	});
// A handler setting the number field name to what's typed, when it's a number ok takes.
export const setNumber = (name, ok) => ({
	args: [t.string()],
	run(next, [text]) {
		const n = typedNumber(text);
		if (n !== null && ok(n)) next[name] = n;
	},
});
export const isCount = (n) => Number.isInteger(n) && n >= 0;

const REMOVE =
	"btn btn-xs btn-circle btn-ghost absolute -right-2 -top-2 z-10 text-error opacity-60 hover:opacity-100";
// A part in a list, edited: the part and a × that sends remove with its index.
export const removable = (title, remove) =>
	div(
		{ class: "relative" },
		renderIt(),
		button({ class: REMOVE, title, "on:click": send(remove, sourceKey()) }, "×"),
	);
// A row in a list, edited (like a header's name and value): the row and, centered beside it,
// a × that sends remove with its index.
export const removableRow = (title, remove) =>
	div(
		{ class: "removable-row flex items-center gap-1" },
		div({ class: "min-w-0 flex-1" }, renderIt()),
		button(
			{
				class: "btn btn-xs btn-square btn-ghost shrink-0 text-error opacity-60 hover:opacity-100",
				title,
				"on:click": send(remove, sourceKey()),
			},
			"×",
		),
	);

// A card's sections: titled parts that collapse, each by its title. Clicking a title opens or
// closes its section; with Ctrl (⌘ on a Mac), every section of the card does the same; with
// Ctrl+Alt, every section, JSON value and schema below it too, in the cards it holds.
// closed lists the sections that are closed; each name gets a query, nameOpen.
export const sectionFields = () => ({ closed: t.array(t.string()) });
const openQuery = (name) => `${name}Open`;
export const sectionQueries = (names) =>
	Object.fromEntries(
		names.map((name) => [
			openQuery(name),
			{
				get() {
					return !this.closed.includes(name);
				},
			},
		]),
	);
// What every section below, in the fields below, takes: setSectionsOpen goes into the cards,
// setOpenDeep into the JSON values and schemas.
const openBelow = (next, below, open) => {
	const into = (v) => {
		if (canApply(v, "setSectionsOpen")) return apply(v, "setSectionsOpen", open);
		if (canApply(v, "setOpenDeep")) return apply(v, "setOpenDeep", open);
		return v;
	};
	for (const key of below) {
		const v = next[key];
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) v[i] = into(v[i]);
		} else if (v !== null) next[key] = into(v);
	}
};
export const sectionMessages = (names, below = []) => ({
	toggleSection: {
		args: [t.enum(...names)],
		run(next, [name], ctx) {
			const e = ctx.event;
			const open = this.closed.includes(name);
			if (e?.ctrlKey || e?.metaKey) {
				next.closed = open ? [] : [...names];
				if (e.altKey) openBelow(next, below, open);
			} else next.closed = open ? this.closed.filter((n) => n !== name) : [...this.closed, name];
		},
	},
	// Every section opens or closes, and every one below it.
	setSectionsOpen: {
		pure: true,
		args: [t.boolean()],
		run(next, [open]) {
			next.closed = open ? [] : [...names];
			openBelow(next, below, open);
		},
	},
});
const SECTION_TITLE = `${PART} flex cursor-pointer items-center gap-1 self-start hover:opacity-100`;
export const titled = (name, title, ...children) =>
	section(
		{ class: "card-section flex flex-col gap-2" },
		h3(
			{ class: "contents" },
			button(
				{
					class: SECTION_TITLE,
					value: name,
					title:
						"Collapse or expand (Ctrl+click: every section; Ctrl+Alt+click: everything inside too)",
					"aria-expanded": $if(field(openQuery(name)), "true", "false"),
					"on:click": send("toggleSection", name),
				},
				span({ class: "w-3", "aria-hidden": "true" }, $if(field(openQuery(name)), "▾", "▸")),
				title,
			),
		),
		$if(field(openQuery(name)), div({ class: "flex flex-col gap-2" }, ...children), ""),
	);
