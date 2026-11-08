// Controls the components share: rows of buttons joined into one, one of them pressed.
import { $if, each, field, send, sourceKey, tag } from "../../src/tutuca.js";

const { button, div } = tag;

// A row of buttons joined into one control, labeled ariaLabel, one per [value, text, on] of
// options: each sends msg with its value and is pressed while the query on holds. Its classes
// are base (a string, or one by value) and active or inactive; attrs(value) adds attributes,
// and box and cls are the row's tag and classes.
export const segmented = (
	ariaLabel,
	msg,
	options,
	{
		base = "btn btn-xs join-item",
		active = "btn-primary",
		inactive = "",
		attrs = () => ({}),
		box = div,
		cls = "join",
	} = {},
) =>
	box(
		{ class: cls, role: "group", "aria-label": ariaLabel },
		...options.map(([value, text, on]) => {
			const b = typeof base === "function" ? base(value) : base;
			return button(
				{
					type: "button",
					class: $if(field(on), `${b} ${active}`.trim(), `${b} ${inactive}`.trim()),
					"aria-pressed": field(on),
					"on:click": send(msg, value),
					...attrs(value),
				},
				text,
			);
		}),
	);

// A row of buttons joined into one control, labeled ariaLabel, one per item of the query
// items, each { cls, pressed, text, title }: each sends msg with its index. label names the
// item's text, attrs the attributes every button adds (its title by default), cls the row's
// classes.
export const pickerRow = (
	ariaLabel,
	items,
	msg,
	{ label = "text", attrs = { title: field("title") }, cls = "join flex w-full" } = {},
) =>
	div(
		{ class: cls, role: "group", "aria-label": ariaLabel },
		each(
			field(items),
			button(
				{
					type: "button",
					class: field("cls"),
					"aria-pressed": field("pressed"),
					"on:click": send(msg, sourceKey()),
					...attrs,
				},
				field(label),
			),
		),
	);
