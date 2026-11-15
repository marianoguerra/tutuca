// What the panels' trees share (DevNode's values, PathStep's steps): the refs their nodes keep
// to live values, and the pieces of a node that opens into rows. A node has canOpen, isOpen,
// showRows and rows, and a toggle message.
import { $if, field, renderEach, send, tag } from "../../tutuca.js";

const { button, div, span } = tag;

// Live values stay out of the state: a node holds a ref to its value, so immer never walks
// or freezes a spec, scope, task or walked step, and the state stays plain data.
const refs = new Map();
const ids = new WeakMap();
let nextRef = 1;
// The ref of an object or a function, made the first time it's asked; 0 for anything else.
export const refIdOf = (v) => {
	if (v === null || (typeof v !== "object" && typeof v !== "function")) return 0;
	let id = ids.get(v);
	if (id === undefined) {
		id = nextRef++;
		ids.set(v, id);
		refs.set(id, new WeakRef(v));
	}
	return id;
};
export const deref = (id) => refs.get(id)?.deref();

// The ▸ that opens a node, or its space when there's nothing to open.
export const expander = $if(
	field("canOpen"),
	button(
		{
			type: "button",
			class: "w-3 shrink-0 cursor-pointer opacity-60 hover:opacity-100",
			"aria-label": "Expand",
			"on:click": send("toggle"),
		},
		$if(field("isOpen"), "▾", "▸"),
	),
	span({ class: "w-3 shrink-0" }),
);
// A node's rows, when it's open.
export const rowsView = $if(
	field("showRows"),
	div({ class: "ml-1.5 border-l border-base-300 pl-3" }, renderEach(field("rows"))),
	"",
);
