// Flexbox for terminal cells. Ported from tuiuiu.js (core/layout.ts; MIT, see LICENSE.tuiuiu),
// without its dirty registry, fingerprints and layout refs: tutuca re-lays out what morph left
// in the tree each paint.
//
// layoutTree(el) reads the terminal DOM into layout input: a { type, props, children, el } per
// element, attributes parsed by name (numbers, booleans), comments left out, a run of bare text
// nodes merged into one text node and a <text> element's text nodes into its content.
// calculateLayout(input, width, height) returns { x, y, width, height, node, children }, x and y
// relative to the parent's content box (inside its border and padding), as tuiuiu's are.
//
// Elements: <text> (content, wrap), <spacer> (grows), <input> (its value, or placeholder, as
// text) and anything else is a box: display, position, flexDirection, flexWrap, flexGrow,
// flexShrink, flexBasis, justifyContent, alignItems, alignSelf, alignContent, padding*, margin*,
// gap, columnGap, rowGap, width, height (cells, "50%", "fill", "auto"), min/max sizes, top,
// bottom, left, right, borderStyle, overflow.
import { fitSegments, segmentsText, stringWidth, stripControls } from "./text.js";

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

// --- reading the terminal DOM ----------------------------------------------------------------

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
const textStyleOf = (props) => {
	const style = {};
	for (const name of TEXT_STYLE) if (props[name] !== undefined) style[name] = props[name];
	return style;
};

// A <text>'s content and its spans: the elements in it style the text in them, nested ones over
// the ones around them, as <span>s do. Each span is { start, end, style, el }, el the innermost
// element its text is in (the <text> itself for its own text), so a click on a word reaches it.
function spansOf(textEl) {
	let content = "";
	const spans = [];
	const walk = (el, style) => {
		for (const child of el.childNodes) {
			if (child.nodeType === 3) {
				const data = stripControls(child.data);
				if (data === "") continue;
				const last = spans.at(-1);
				if (last && last.el === el && last.end === content.length) last.end += data.length;
				else spans.push({ start: content.length, end: content.length + data.length, style, el });
				content += data;
			} else if (child.nodeType === 1) {
				walk(child, { ...style, ...textStyleOf(propsOf(child)) });
			}
		}
	};
	walk(textEl, {});
	return { content, spans };
}

const textNode = (content, props, el) => ({
	type: "text",
	props: { ...props, children: content },
	children: [],
	el,
});

function childrenOf(el) {
	const out = [];
	let run = null; // Bare text nodes in a row show as one text, as inline text does in HTML.
	for (const child of el.childNodes) {
		if (child.nodeType === 3) {
			if (child.data === "") continue;
			if (run === null) {
				run = textNode("", {}, el);
				run.texts = [];
				out.push(run);
			}
			run.props.children += stripControls(child.data);
			run.texts.push(child);
			continue;
		}
		run = null;
		if (child.nodeType === 1) out.push(layoutTree(child));
	}
	return out;
}

export function layoutTree(el) {
	const props = propsOf(el);
	switch (el.localName) {
		case "text": {
			const { content, spans } = spansOf(el);
			// Spans only when an element inside styles or handles part of it.
			const styled = spans.some((s) => s.el !== el);
			return styled ? { ...textNode(content, props, el), spans } : textNode(content, props, el);
		}
		case "input":
		case "textarea": {
			const value = el.value;
			const shown = value === "" ? (props.placeholder ?? "") : value;
			return {
				...textNode(stripControls(shown), props, el),
				input: true,
				multiline: el.localName === "textarea",
				empty: value === "",
			};
		}
		case "spacer":
			return { type: "spacer", props: { flexGrow: 1, flexShrink: 0, ...props }, children: [], el };
		case "divider":
			return { type: "divider", props, children: [], el };
		default:
			return { type: "box", props, children: childrenOf(el), el };
	}
}

// --- layout ----------------------------------------------------------------------------------

const nonNegative = (value, name) => {
	if (value === undefined) return 0;
	if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`);
	return Math.max(0, Math.floor(value));
};
const factor = (value, name) => {
	if (value === undefined) return 0;
	if (!Number.isFinite(value) || value < 0)
		throw new RangeError(`${name} must be a non-negative number`);
	return value;
};
const margin = (v) => (v === "auto" ? 0 : nonNegative(v, "margin"));
const marginsOf = (s) => ({
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
export const borderOf = (s) => (s.borderStyle && s.borderStyle !== "none" ? 1 : 0);
const hasSize = (v) => v !== undefined && v !== "auto";
const alignOf = (style, parent) =>
	style.alignSelf && style.alignSelf !== "auto"
		? style.alignSelf
		: (parent.alignItems ?? "flex-start");

function resolveSize(size, available) {
	if (size === undefined || size === "auto") return 0;
	if (size === "fill") return available === Infinity ? 0 : available;
	if (typeof size === "number") {
		if (!Number.isFinite(size) || size < 0)
			throw new RangeError("a size must be a non-negative number");
		return Math.floor(size);
	}
	if (size.endsWith("%")) {
		const pct = Number.parseFloat(size);
		if (!Number.isFinite(pct) || pct < 0) throw new RangeError(`bad percentage: ${size}`);
		return available === Infinity ? 0 : Math.floor((pct / 100) * available);
	}
	throw new RangeError(`bad size: ${size}`);
}

const withBox = (layout, patch) => {
	const next = { ...layout, ...patch };
	return next.x === layout.x &&
		next.y === layout.y &&
		next.width === layout.width &&
		next.height === layout.height
		? layout
		: next;
};

// A column grown taller than its content spreads it by its justifyContent.
function stretchHeight(layout, target, style) {
	if (target <= layout.height) return withBox(layout, { height: target });
	const dir = style.flexDirection ?? "column";
	if (layout.children.length === 0 || (dir !== "column" && dir !== "column-reverse")) {
		return withBox(layout, { height: target });
	}
	const extra = target - layout.height;
	const kids = layout.children;
	const n = kids.length;
	const offsetOf = {
		center: () => Math.floor(extra / 2),
		"flex-end": () => extra,
		"space-between": (i) => (n > 1 ? Math.floor((extra * i) / (n - 1)) : 0),
		"space-around": (i) => Math.floor((extra / (n * 2)) * (2 * i + 1)),
		"space-evenly": (i) => Math.floor((extra / (n + 1)) * (i + 1)),
	}[style.justifyContent ?? "flex-start"];
	const children = offsetOf ? kids.map((c, i) => withBox(c, { y: c.y + offsetOf(i) })) : kids;
	return { ...layout, height: target, children };
}

// A text is as wide as its widest line, unless it has a width or grows (an <input> filling its
// row): then it takes that.
function layoutText(node, ctx) {
	const s = node.props;
	const own = hasSize(s.width) && s.width !== "fill" ? resolveSize(s.width, ctx.width) : null;
	const grows = factor(s.flexGrow, "flexGrow") > 0 || s.width === "fill";
	const room = own ?? ctx.width;
	// An input is one line, scrolled sideways to its caret when painted.
	const content = String(s.children ?? "");
	// rows are segments of content (text.js's fitSegments), so spans keep their styles; lines,
	// their text.
	// A textarea is its lines as they are, scrolled to its caret when painted: as tall as they are
	// unless it has a height (maxHeight caps it), a cell wider for the caret after the longest.
	if (node.multiline) {
		const lines = content.split("\n");
		let height = hasSize(s.height) ? resolveSize(s.height, ctx.height) : lines.length;
		if (s.maxHeight !== undefined) height = Math.min(height, nonNegative(s.maxHeight, "maxHeight"));
		const width = own ?? (grows ? ctx.width : Math.max(0, ...lines.map(stringWidth)) + 1);
		const h = Math.min(Math.max(1, height), ctx.height);
		return {
			x: ctx.x,
			y: ctx.y,
			width: Math.min(width, ctx.width),
			height: h,
			node,
			children: [],
			lines,
			rows: null,
		};
	}
	const rows = node.input ? null : fitSegments(content, room, s.wrap);
	const lines = node.input
		? [content.replace(/\n/g, " ")]
		: rows.map((row) => segmentsText(content, row));
	const width = own ?? (grows ? ctx.width : Math.max(0, ...lines.map(stringWidth)));
	return {
		x: ctx.x,
		y: ctx.y,
		width: Math.min(width, ctx.width),
		height: Math.min(lines.length, ctx.height),
		node,
		children: [],
		lines,
		rows,
	};
}

// A divider is one cell thick: as wide as it's let be in a column, and in a row one cell wide
// and as tall as the row (layoutRow stretches it).
function layoutDivider(node, ctx) {
	const m = marginsOf(node.props);
	const room = Math.max(0, ctx.width - m.left - m.right);
	const own = hasSize(node.props.width) ? resolveSize(node.props.width, room) : room;
	const width = node.vertical ? 1 : Math.min(own, room);
	return {
		x: ctx.x + m.left,
		y: ctx.y + m.top,
		width,
		height: Math.min(1, ctx.height),
		node,
		children: [],
	};
}

function layoutSpacer(node, ctx) {
	const w = typeof node.props.width === "number" ? node.props.width : 0;
	const h = typeof node.props.height === "number" ? node.props.height : 0;
	return {
		x: ctx.x,
		y: ctx.y,
		width: Math.min(w, ctx.width),
		height: Math.min(h, ctx.height),
		node,
		children: [],
	};
}

// The layout of node in width × height. An element with position fixed is on a layer of its own:
// laid out against the whole screen, placed by top, left, right and bottom (the top left
// without them), and drawn over everything, by zIndex and then tree order. The root layout's
// layers lists them, bottom to top, their x and y on the screen.
export function calculateLayout(node, width, height = Infinity) {
	if (!Number.isFinite(width) || width < 0)
		throw new RangeError("width must be a non-negative number");
	if (height !== Infinity && (!Number.isFinite(height) || height < 0)) {
		throw new RangeError("height must be a non-negative number or Infinity");
	}
	const screen = {
		x: 0,
		y: 0,
		width: Math.floor(width),
		height: height === Infinity ? height : Math.floor(height),
	};
	const layout = layoutNode(node, screen);
	layout.layers = fixedNodesOf(node)
		.map((fixed, order) => ({ layer: layoutFixed(fixed, screen), order }))
		.sort(
			(a, b) =>
				(a.layer.node.props.zIndex ?? 0) - (b.layer.node.props.zIndex ?? 0) || a.order - b.order,
		)
		.map(({ layer }) => layer);
	return layout;
}

// The fixed nodes in node's tree, in tree order; none under a display none.
function fixedNodesOf(node, out = []) {
	for (const child of node.children) {
		if (child.props.display === "none") continue;
		if (child.props.position === "fixed") out.push(child);
		fixedNodesOf(child, out);
	}
	return out;
}

function layoutFixed(node, screen) {
	const s = node.props;
	const laid = layoutNode(node, { ...screen, x: 0, y: 0 });
	const room = (size, own) => (size === Infinity ? 0 : size - own);
	const x =
		s.left !== undefined
			? s.left
			: s.right !== undefined
				? room(screen.width, laid.width) - s.right
				: laid.x;
	const y =
		s.top !== undefined
			? s.top
			: s.bottom !== undefined
				? room(screen.height, laid.height) - s.bottom
				: laid.y;
	return withBox(laid, { x, y });
}

function layoutNode(node, ctx) {
	if (node.type === "text") return layoutText(node, ctx);
	if (node.type === "spacer") return layoutSpacer(node, ctx);
	if (node.type === "divider") return layoutDivider(node, ctx);
	const style = node.props;
	if (style.display === "none")
		return { x: ctx.x, y: ctx.y, width: 0, height: 0, node, children: [] };

	const pad = paddingOf(style);
	const m = marginsOf(style);
	const border = borderOf(style);
	const explicitWidth = resolveSize(style.width, ctx.width);
	const explicitHeight = resolveSize(style.height, ctx.height);
	const hasWidth = hasSize(style.width);
	// Inside a scroll container there's no height to fill.
	const hasHeight = hasSize(style.height) && !(style.height === "fill" && ctx.height === Infinity);
	const maxWidth =
		style.maxWidth === undefined ? undefined : nonNegative(style.maxWidth, "maxWidth");
	const maxHeight =
		style.maxHeight === undefined ? undefined : nonNegative(style.maxHeight, "maxHeight");
	const outerWidth = Math.min(hasWidth ? explicitWidth : ctx.width, maxWidth ?? Infinity);
	const outerHeight = Math.min(hasHeight ? explicitHeight : ctx.height, maxHeight ?? Infinity);
	const contentWidth = Math.max(0, outerWidth - pad.left - pad.right - border * 2);
	const contentHeight = Math.max(0, outerHeight - pad.top - pad.bottom - border * 2);

	const direction = style.flexDirection ?? "column";
	const isRow = direction === "row" || direction === "row-reverse";
	const isReverse = direction.endsWith("-reverse");
	// A split box needs a cell between its children for each line it draws.
	const split = style.split !== undefined && style.split !== "false";
	const ownGap = nonNegative(
		isRow ? (style.columnGap ?? style.gap) : (style.rowGap ?? style.gap),
		"gap",
	);
	const gap = split ? Math.max(1, ownGap) : ownGap;
	// A divider runs across a column and down a row.
	for (const child of node.children) if (child.type === "divider") child.vertical = isRow;

	// A fixed child isn't laid out here: calculateLayout lays it out on its layer.
	const absolute = node.children.filter((c) => c.props.position === "absolute");
	const flow = node.children.filter(
		(c) => c.props.position !== "absolute" && c.props.position !== "fixed",
	);
	const ordered = isReverse ? [...flow].reverse() : flow;
	// A scroll container lays its content out as tall as it is, and shows a viewport of it.
	const scrolls = scrollsOf(style);
	const childHeight = scrolls ? Infinity : contentHeight;
	const children = isRow
		? layoutRow(ordered, contentWidth, childHeight, gap, style, hasHeight && !scrolls)
		: layoutColumn(ordered, contentWidth, childHeight, gap, style);

	let totalWidth = 0;
	let totalHeight = 0;
	for (const child of children) {
		const cm = marginsOf(child.node.props);
		totalWidth = Math.max(totalWidth, isRow ? child.x + child.width + cm.right : child.width);
		totalHeight = Math.max(totalHeight, child.y + child.height + cm.bottom);
	}

	const fillWidth = factor(style.flexGrow, "flexGrow") > 0 || style.width === "fill";
	let width = hasWidth
		? explicitWidth
		: fillWidth
			? ctx.width
			: totalWidth + pad.left + pad.right + border * 2;
	let height = hasHeight ? explicitHeight : totalHeight + pad.top + pad.bottom + border * 2;
	width = Math.max(width, nonNegative(style.minWidth, "minWidth"));
	height = Math.max(height, nonNegative(style.minHeight, "minHeight"));
	if (maxWidth !== undefined) width = Math.min(width, maxWidth);
	if (maxHeight !== undefined) height = Math.min(height, maxHeight);

	if (isRow && style.alignItems === "stretch") {
		const inner = Math.max(0, height - pad.top - pad.bottom - border * 2);
		for (let i = 0; i < children.length; i++) {
			const childStyle = children[i].node.props;
			if (childStyle.height !== undefined) continue;
			children[i] = stretchHeight(children[i], Math.max(children[i].height, inner), childStyle);
		}
	}

	const layoutWidth = Math.max(0, Math.min(width, Math.max(0, ctx.width - m.left - m.right)));
	const layoutHeight = Math.max(0, Math.min(height, Math.max(0, ctx.height - m.top - m.bottom)));
	const innerWidth = layoutWidth - pad.left - pad.right - border * 2;
	const innerHeight = layoutHeight - pad.top - pad.bottom - border * 2;

	// Absolute children take no space and sit in this box's content area by top/left/right/bottom.
	for (const child of absolute) {
		const s = child.props;
		const laid = layoutNode(child, { x: 0, y: 0, width: contentWidth, height: contentHeight });
		const x =
			s.left !== undefined ? s.left : s.right !== undefined ? innerWidth - laid.width - s.right : 0;
		const y =
			s.top !== undefined
				? s.top
				: s.bottom !== undefined
					? innerHeight - laid.height - s.bottom
					: 0;
		children.push(withBox(laid, { x, y }));
	}

	const layout = {
		x: ctx.x + m.left,
		y: ctx.y + m.top,
		width: layoutWidth,
		height: layoutHeight,
		node,
		children,
	};
	if (scrolls) {
		layout.scrollHeight = totalHeight;
		layout.clientHeight = Math.max(0, innerHeight);
	}
	return layout;
}

// Integer shrinking: an exact number of columns, shared by shrink × basis with the largest
// remainders getting the leftover ones, so one column of overflow never shrinks two children.
function shrinkReductions(infos, overflow) {
	const reductions = infos.map(() => 0);
	let remaining = Math.ceil(overflow);
	while (remaining > 0) {
		const candidates = infos
			.map((info, index) => {
				const max = Math.max(0, Math.floor(info.basis - info.minWidth));
				return {
					index,
					max,
					capacity: Math.max(0, max - reductions[index]),
					weight: info.shrink * info.basis,
				};
			})
			.filter((c) => c.capacity > 0 && c.weight > 0);
		const total = candidates.reduce((t, c) => t + c.weight, 0);
		if (total <= 0) break;
		const left = remaining;
		const shares = candidates.map((c) => {
			const exact = (left * c.weight) / total;
			return {
				...c,
				whole: Math.min(c.capacity, Math.floor(exact)),
				fraction: exact - Math.floor(exact),
			};
		});
		for (const s of shares) {
			reductions[s.index] += s.whole;
			remaining -= s.whole;
		}
		if (remaining <= 0) break;
		shares.sort(
			(a, b) => b.fraction - a.fraction || b.weight - a.weight || b.capacity - a.capacity,
		);
		let any = false;
		for (const s of shares) {
			if (remaining <= 0) break;
			if (reductions[s.index] < s.max) {
				reductions[s.index]++;
				remaining--;
				any = true;
			}
		}
		if (!any) break;
	}
	return reductions;
}

function layoutRow(children, width, height, gap, parentStyle, hasExplicitHeight) {
	const wrap = parentStyle.flexWrap ?? "nowrap";
	if (wrap !== "nowrap" && children.length > 0) {
		return layoutWrappedRows(children, width, height, gap, parentStyle, hasExplicitHeight, wrap);
	}
	let fixedWidth = 0;
	let flexTotal = 0;
	const infos = [];
	for (const child of children) {
		const s = child.props;
		const flex =
			s.flexGrow === undefined
				? s.width === "fill" || child.type === "spacer"
					? 1
					: 0
				: factor(s.flexGrow, "flexGrow");
		const minWidth = nonNegative(s.minWidth, "minWidth");
		const basis =
			s.flexBasis === "content"
				? layoutNode(child, { x: 0, y: 0, width, height }).width
				: s.flexBasis === undefined || s.flexBasis === "auto"
					? minWidth
					: resolveSize(s.flexBasis, width);
		const shrink = s.flexShrink === undefined ? 1 : factor(s.flexShrink, "flexShrink");
		const { left: marginLeft, right: marginRight } = marginsOf(s);
		if (flex > 0) {
			flexTotal += flex;
			fixedWidth += basis + marginLeft + marginRight;
			infos.push({ node: child, flex, minWidth, basis, shrink, marginLeft, marginRight });
		} else {
			// A child with its own width is measured at it, so the second pass only moves it.
			const ownWidth = s.width !== undefined && s.width !== "auto" && s.width !== "fill";
			const measuredWidth = ownWidth
				? resolveSize(s.width, width) + marginLeft + marginRight
				: width;
			const layout = layoutNode(child, { x: 0, y: 0, width: measuredWidth, height });
			fixedWidth += layout.width + marginLeft + marginRight;
			infos.push({
				node: child,
				flex: 0,
				minWidth,
				basis: layout.width,
				shrink,
				marginLeft,
				marginRight,
				layout,
				measuredWidth,
			});
		}
	}
	fixedWidth += gap * Math.max(0, children.length - 1);

	const overflow = Math.max(0, fixedWidth - width);
	if (overflow > 0) {
		const reductions = shrinkReductions(infos, overflow);
		if (reductions.some((r) => r > 0)) {
			infos.forEach((info, i) => {
				info.targetWidth = Math.max(info.minWidth, info.basis - reductions[i]);
			});
			fixedWidth = infos.reduce(
				(t, info) => t + (info.targetWidth ?? info.basis) + info.marginLeft + info.marginRight,
				gap * Math.max(0, children.length - 1),
			);
		}
	}

	const flexSpace = Math.max(0, width - fixedWidth);
	const flexUnit = flexTotal > 0 ? flexSpace / flexTotal : 0;
	const justify = parentStyle.justifyContent ?? "flex-start";
	const remaining = width - (fixedWidth + (flexTotal > 0 ? flexSpace : 0));
	let x = 0;
	let between = 0;
	let around = 0;
	if (flexTotal === 0 && infos.length > 0) {
		if (justify === "space-between" && infos.length > 1) between = remaining / (infos.length - 1);
		else if (justify === "space-around") x = around = remaining / (infos.length * 2);
		else if (justify === "space-evenly") x = between = remaining / (infos.length + 1);
		else if (justify === "flex-end") x = remaining;
		else if (justify === "center") x = remaining / 2;
	}

	let rowHeight = 0;
	const placed = [];
	infos.forEach((info, i) => {
		const childWidth =
			info.targetWidth ??
			(info.flex > 0 ? info.basis + Math.floor(flexUnit * info.flex) : info.basis);
		const allocated = childWidth + info.marginLeft + info.marginRight;
		const cx = Math.floor(x);
		const layout =
			info.layout && info.measuredWidth === allocated
				? withBox(info.layout, { x: info.layout.x + cx })
				: layoutNode(info.node, { x: cx, y: 0, width: allocated, height });
		rowHeight = Math.max(rowHeight, layout.height);
		placed.push(layout);
		x += info.marginLeft + layout.width + info.marginRight;
		if (justify === "space-between" && i < infos.length - 1) x += between;
		else if (justify === "space-around") x += around * 2;
		else if (justify === "space-evenly") x += between;
		else x += gap;
	});

	const alignHeight = hasExplicitHeight && height !== Infinity ? height : rowHeight;
	return placed.map((layout) => {
		const s = layout.node.props;
		const align = alignOf(s, parentStyle);
		let y = layout.y;
		let h = layout.height;
		if (align === "stretch" || layout.node.type === "divider") {
			if (s.height === undefined) h = Math.max(layout.height, alignHeight);
			y = 0;
		} else if (align === "center") y = Math.floor((alignHeight - layout.height) / 2);
		else if (align === "flex-end") y = alignHeight - layout.height;
		else if (align === "baseline") y = 0;
		return withBox(stretchHeight(layout, h, s), { y });
	});
}

function layoutWrappedRows(
	children,
	width,
	height,
	columnGap,
	parentStyle,
	hasExplicitHeight,
	wrap,
) {
	const lines = [];
	let line = [];
	let lineWidth = 0;
	for (const child of children) {
		const s = child.props;
		const { left, right } = marginsOf(s);
		const measured = layoutNode(child, { x: 0, y: 0, width, height });
		const basis =
			s.flexBasis === undefined || s.flexBasis === "auto" || s.flexBasis === "content"
				? measured.width
				: resolveSize(s.flexBasis, width);
		const itemWidth = basis + left + right;
		if (line.length > 0 && lineWidth + columnGap + itemWidth > width) {
			lines.push(line);
			line = [];
			lineWidth = 0;
		}
		lineWidth += (line.length > 0 ? columnGap : 0) + itemWidth;
		line.push(child);
	}
	if (line.length > 0) lines.push(line);
	if (wrap === "wrap-reverse") lines.reverse();

	const rowGap = nonNegative(parentStyle.rowGap ?? parentStyle.gap, "rowGap");
	const laid = lines.map((items) => {
		const layouts = layoutRow(
			items,
			width,
			height,
			columnGap,
			{ ...parentStyle, flexWrap: "nowrap", alignContent: undefined },
			false,
		);
		return { layouts, height: layouts.reduce((m, l) => Math.max(m, l.y + l.height), 0) };
	});
	const contentHeight = laid.reduce((t, l) => t + l.height, rowGap * Math.max(0, laid.length - 1));
	const free = hasExplicitHeight ? Math.max(0, height - contentHeight) : 0;
	const alignContent = parentStyle.alignContent ?? "flex-start";
	let y = 0;
	let extra = 0;
	if (alignContent === "flex-end") y = free;
	else if (alignContent === "center") y = Math.floor(free / 2);
	else if (alignContent === "space-between" && laid.length > 1) extra = free / (laid.length - 1);
	else if (alignContent === "space-around" && laid.length > 0) {
		extra = free / laid.length;
		y = Math.floor(extra / 2);
	} else if (alignContent === "stretch" && laid.length > 0) extra = free / laid.length;

	const results = [];
	for (const l of laid) {
		for (const layout of l.layouts) results.push(withBox(layout, { y: layout.y + Math.floor(y) }));
		y += l.height + rowGap + extra;
	}
	return results;
}

const alignX = (layout, width, align) => {
	if (align === "center") return { x: Math.floor((width - layout.width) / 2), width: layout.width };
	if (align === "flex-end") return { x: width - layout.width, width: layout.width };
	if (align === "stretch") return { x: layout.x, width };
	return { x: layout.x, width: layout.width };
};

function layoutColumn(children, width, height, gap, parentStyle) {
	const results = [];
	if (hasSize(parentStyle.height) && height !== Infinity) {
		let fixedHeight = 0;
		let flexTotal = 0;
		const infos = [];
		for (const child of children) {
			const s = child.props;
			const { top, bottom } = marginsOf(s);
			const flex =
				s.flexGrow === undefined
					? s.height === "fill" || child.type === "spacer"
						? 1
						: 0
					: factor(s.flexGrow, "flexGrow");
			const minHeight = nonNegative(s.minHeight, "minHeight");
			const maxHeight =
				s.maxHeight === undefined ? undefined : nonNegative(s.maxHeight, "maxHeight");
			if (flex > 0) {
				flexTotal += flex;
				fixedHeight += top + bottom;
				infos.push({ node: child, flex, minHeight, maxHeight, top, bottom });
			} else {
				const layout = layoutNode(child, { x: 0, y: 0, width, height });
				fixedHeight += layout.height + top + bottom;
				infos.push({ node: child, flex: 0, minHeight, maxHeight, top, bottom, layout });
			}
		}
		fixedHeight += gap * Math.max(0, children.length - 1);
		if (flexTotal > 0) {
			const unit = Math.max(0, height - fixedHeight) / flexTotal;
			let y = 0;
			infos.forEach((info, i) => {
				let layout = info.layout;
				if (info.flex > 0) {
					let h = Math.max(info.minHeight, Math.floor(unit * info.flex));
					if (info.maxHeight !== undefined) h = Math.min(info.maxHeight, h);
					layout = withBox(layoutNode(info.node, { x: 0, y, width, height: h }), { height: h });
				}
				layout = withBox(layout, {
					y: y + info.top,
					...alignX(layout, width, alignOf(info.node.props, parentStyle)),
				});
				results.push(layout);
				y += info.top + layout.height + info.bottom + (i < infos.length - 1 ? gap : 0);
			});
			return results;
		}
	}

	let y = 0;
	children.forEach((child, i) => {
		const s = child.props;
		const { top, bottom } = marginsOf(s);
		const layout = layoutNode(child, { x: 0, y, width, height: height - y });
		results.push(withBox(layout, alignX(layout, width, alignOf(s, parentStyle))));
		y += top + layout.height + bottom + (i < children.length - 1 ? gap : 0);
	});

	const room = parentStyle.height !== undefined && height !== Infinity ? height : y;
	const remaining = Math.max(0, room - y);
	const justify = parentStyle.justifyContent ?? "flex-start";
	if (remaining <= 0 || results.length === 0) return results;
	const n = results.length;
	const offsetOf = {
		"flex-end": () => remaining,
		center: () => Math.floor(remaining / 2),
		"space-between": (i) => (n > 1 ? Math.floor((remaining / (n - 1)) * i) : 0),
		"space-around": (i) => Math.floor((remaining / (n * 2)) * (2 * i + 1)),
		"space-evenly": (i) => Math.floor((remaining / (n + 1)) * (i + 1)),
	}[justify];
	return offsetOf ? results.map((r, i) => withBox(r, { y: r.y + offsetOf(i) })) : results;
}

// Walks a layout giving each node its absolute rect on screen (layout.rect) and each element its
// rect (el.rect) and layout (el.layout), for hit testing and events. A scroll container's
// children move up by its scrollTop, clamped to what it has to scroll, and it gets
// scrollHeight, clientHeight and viewport (its content box on screen), as elements on a page do.
export function absolutize(layout, ox = 0, oy = 0) {
	const x = ox + layout.x;
	const y = oy + layout.y;
	layout.rect = { x, y, w: layout.width, h: layout.height };
	const { el } = layout.node;
	// A run of bare text belongs to its parent's element, whose rect is the box's.
	const own = el && !layout.node.texts;
	if (own) {
		el.rect = layout.rect;
		el.layout = layout;
	}
	const s = layout.node.props;
	const pad = paddingOf(s);
	const b = borderOf(s);
	const cx = x + pad.left + b;
	const cy = y + pad.top + b;
	let top = 0;
	if (own && layout.scrollHeight !== undefined) {
		el.scrollHeight = layout.scrollHeight;
		el.clientHeight = layout.clientHeight;
		const w = layout.width - pad.left - pad.right - 2 * b;
		el.viewport = { x: cx, y: cy, w, h: layout.clientHeight };
		// Written past the setter: layout clamps it without asking for another paint.
		const max = layout.scrollHeight - layout.clientHeight;
		el._scrollTop = Math.max(0, Math.min(el._scrollTop, max));
		top = el._scrollTop;
	}
	for (const child of layout.children) absolutize(child, cx, cy - top);
	// Layers are placed on the screen.
	for (const layer of layout.layers ?? []) absolutize(layer, 0, 0);
	return layout;
}
