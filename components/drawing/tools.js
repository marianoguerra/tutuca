// What the drawing and the canvas share of their toolbars: the tool buttons and how a paint's
// swatch looks.
import { each, field, send, tag, targetValue } from "../../src/tutuca.js";

export const TOOL_ON = "btn btn-sm btn-square btn-primary join-item";
export const TOOL_OFF = "btn btn-sm btn-square join-item";
// A tool, [id, icon, label, shape], as its toolbar button: pressed when it's current.
export const toolButton = ([id, icon, label], current) => ({
	id,
	icon,
	label,
	cls: id === current ? TOOL_ON : TOOL_OFF,
});
// The buttons of the toolButtons query, each sending setTool with its id.
export const toolButtons = () =>
	each(
		field("toolButtons"),
		tag.button(
			{
				class: field("cls"),
				title: field("label"),
				"aria-label": field("label"),
				value: field("id"),
				"on:click": send("setTool", targetValue()),
			},
			field("icon"),
		),
	);
// A paint's swatch: its color, or white struck through in red for none.
const NONE_STYLE = "background:repeating-linear-gradient(45deg,#fff 0 3px,#ef4444 3px 5px)";
export const swatchStyle = (paint) => (paint === "none" ? NONE_STYLE : `background:${paint}`);
