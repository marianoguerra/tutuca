// What an element's attributes say, as layout and paint read them: props parsed by name (numbers,
// booleans), the text styles that inherit, and a box's margins, padding, border, clipping and
// content box.
const NUMBERS = new Set(
	"flexGrow flexShrink flex padding paddingX paddingY paddingTop paddingBottom paddingLeft paddingRight gap columnGap rowGap minWidth minHeight maxWidth maxHeight top bottom left right zIndex".split(
		" ",
	),
);
// Margins, sizes and flexBasis are numbers unless they are a keyword or a percentage.
const MAYBE_NUMBERS = new Set(
	"margin marginX marginY marginTop marginBottom marginLeft marginRight width height flexBasis".split(
		" ",
	),
);
const BOOLEANS = new Set(
	"borderTop borderBottom borderLeft borderRight bold dim italic inverse strikethrough borderDim borderDimTop borderDimBottom borderDimLeft borderDimRight".split(
		" ",
	),
);
const isNumeric = (v) => v.trim() !== "" && Number.isFinite(Number(v));

export function parseProp(name, value) {
	if (NUMBERS.has(name)) {
		const n = Number(value);
		if (!Number.isFinite(n))
			throw new RangeError(`${name} must be a number, got ${JSON.stringify(value)}`);
		return n;
	}
	if (MAYBE_NUMBERS.has(name)) return isNumeric(value) ? Number(value) : value;
	if (BOOLEANS.has(name)) return value !== "false";
	return value;
}
export function propsOf(el) {
	const props = {};
	for (const [name, value] of el.attributes) props[name] = parseProp(name, value);
	return props;
}

// The attributes that style text, and inherit down the tree as CSS's do.
export const TEXT_STYLE = [
	"color",
	"backgroundColor",
	"bold",
	"dim",
	"italic",
	"underline",
	"inverse",
	"strikethrough",
];
export const textStyleOf = (props) => {
	const style = {};
	for (const name of TEXT_STYLE) if (props[name] !== undefined) style[name] = props[name];
	return style;
};

export const nonNegative = (value, name) => {
	if (value === undefined) return 0;
	if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`);
	return Math.max(0, Math.floor(value));
};
export const factor = (value, name) => {
	if (value === undefined) return 0;
	if (!Number.isFinite(value) || value < 0)
		throw new RangeError(`${name} must be a non-negative number`);
	return value;
};
const margin = (v) => (v === "auto" ? 0 : nonNegative(v, "margin"));
export const marginsOf = (s) => ({
	top: margin(s.marginTop ?? s.marginY ?? s.margin),
	bottom: margin(s.marginBottom ?? s.marginY ?? s.margin),
	left: margin(s.marginLeft ?? s.marginX ?? s.margin),
	right: margin(s.marginRight ?? s.marginX ?? s.margin),
});
export const paddingOf = (s) => ({
	top: nonNegative(s.paddingTop ?? s.paddingY ?? s.padding, "paddingTop"),
	bottom: nonNegative(s.paddingBottom ?? s.paddingY ?? s.padding, "paddingBottom"),
	left: nonNegative(s.paddingLeft ?? s.paddingX ?? s.padding, "paddingLeft"),
	right: nonNegative(s.paddingRight ?? s.paddingX ?? s.padding, "paddingRight"),
});
// Whether a box scrolls its content vertically: overflow or overflowY scroll or auto.
export const scrollsOf = (s) => {
	const y = s.overflowY ?? s.overflow;
	return y === "scroll" || y === "auto";
};
// What a box clips its content to, on each axis: hidden, scroll and auto clip.
export const clipsOf = (s) => {
	const clip = (v) => v === "hidden" || v === "scroll" || v === "auto";
	return { x: clip(s.overflowX ?? s.overflow), y: clip(s.overflowY ?? s.overflow) };
};
export const borderWidthOf = (s) => (s.borderStyle && s.borderStyle !== "none" ? 1 : 0);
// A box's content box: rect ({ x, y, w, h }) inside its border and padding.
export const contentBox = (rect, s) => {
	const b = borderWidthOf(s);
	const pad = paddingOf(s);
	return {
		x: rect.x + b + pad.left,
		y: rect.y + b + pad.top,
		w: rect.w - 2 * b - pad.left - pad.right,
		h: rect.h - 2 * b - pad.top - pad.bottom,
	};
};
// Whether x, y is in rect.
export const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
