// Flexbox for terminal cells. Ported from tuiuiu.js (core/layout.ts; MIT, see LICENSE.tuiuiu),
// without its dirty registry, fingerprints and layout refs: tutuca re-lays out what morph left
// in the tree each paint.
//
// calculateLayout(input, width, height), input as layout-input.js reads it from the terminal
// DOM, returns { x, y, width, height, node, children }, x and y relative to the parent's content
// box (inside its border and padding), as tuiuiu's are. absolutize puts it on the screen.
//
// Elements: <text> (content, wrap), <spacer> (grows), <input> and <textarea> (their value, or
// placeholder, as text), <divider> (a line across its parent) and anything else is a box:
// display, position, flexDirection, flexWrap, flexGrow, flexShrink, flexBasis, justifyContent,
// alignItems, alignSelf, alignContent, padding*, margin*, gap, columnGap, rowGap, width, height
// (cells, "50%", "fill", "auto"), min/max sizes, top, bottom, left, right, borderStyle, overflow.
//
// Units: cells by default; metrics (metrics.js) lay out in others (a canvas's pixels), measuring
// text by its font and giving borders, rules and the caret their room. Every layout keeps its
// inset (a box's border and padding on each side, in those units) for absolutize, hit testing
// and painting, and its border (how thick each side is).
import { cellMetrics } from "./metrics.js";
import { borderWidthOf, factor, marginsOf, nonNegative, paddingOf, scrollsOf } from "./props.js";
import { fitSegments, measureWidth, segmentsText } from "./text.js";

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

// How far justifyContent moves the i-th of n children down a column with extra rows to spare;
// undefined for flex-start, which moves none.
const justifyOffset = (justify, extra, n) =>
	({
		center: () => Math.floor(extra / 2),
		"flex-end": () => extra,
		"space-between": (i) => (n > 1 ? Math.floor((extra * i) / (n - 1)) : 0),
		"space-around": (i) => Math.floor((extra / (n * 2)) * (2 * i + 1)),
		"space-evenly": (i) => Math.floor((extra / (n + 1)) * (i + 1)),
	})[justify];
// How much of the spare space a child takes: its flexGrow, or 1 for a spacer or a size of "fill".
const flexOf = (child, size) =>
	child.props.flexGrow === undefined
		? size === "fill" || child.type === "spacer"
			? 1
			: 0
		: factor(child.props.flexGrow, "flexGrow");

// A column grown taller than its content spreads it by its justifyContent.
function stretchHeight(layout, target, style) {
	if (target <= layout.height) return withBox(layout, { height: target });
	const dir = style.flexDirection ?? "column";
	if (layout.children.length === 0 || (dir !== "column" && dir !== "column-reverse")) {
		return withBox(layout, { height: target });
	}
	const extra = target - layout.height;
	const kids = layout.children;
	const offsetOf = justifyOffset(style.justifyContent, extra, kids.length);
	const children = offsetOf ? kids.map((c, i) => withBox(c, { y: c.y + offsetOf(i) })) : kids;
	return { ...layout, height: target, children };
}

// A text is as wide as its widest line, unless it has a width or grows (an <input> filling its
// row): then it takes that.
function layoutText(node, ctx, m) {
	const measure = m.measureOf(node);
	const widest = (lines) => Math.ceil(Math.max(0, ...lines.map((l) => measureWidth(l, measure))));
	const s = node.props;
	const own = hasSize(s.width) && s.width !== "fill" ? resolveSize(s.width, ctx.width) : null;
	const grows = factor(s.flexGrow, "flexGrow") > 0 || s.width === "fill";
	const room = own ?? ctx.width;
	const content = String(s.children ?? "");
	// A textarea is its lines as they are, scrolled to its caret when painted: as tall as they are
	// unless it has a height (maxHeight caps it), a cell wider for the caret after the longest.
	if (node.multiline) {
		const lines = content.split("\n");
		let height = hasSize(s.height)
			? resolveSize(s.height, ctx.height)
			: lines.length * m.lineHeight;
		if (s.maxHeight !== undefined) height = Math.min(height, nonNegative(s.maxHeight, "maxHeight"));
		const width = own ?? (grows ? ctx.width : widest(lines) + m.caret);
		const h = Math.min(Math.max(m.lineHeight, height), ctx.height);
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
	// An input is one line, scrolled sideways to its caret when painted. Anything else: rows are
	// segments of content (text.js's fitSegments), so spans keep their styles; lines, their text.
	const rows = node.input ? null : fitSegments(content, room, s.wrap, measure);
	const lines = node.input
		? [content.replace(/\n/g, " ")]
		: rows.map((row) => segmentsText(content, row));
	const width = own ?? (grows ? ctx.width : widest(lines));
	return {
		x: ctx.x,
		y: ctx.y,
		width: Math.min(width, ctx.width),
		height: Math.min(lines.length * m.lineHeight, ctx.height),
		node,
		children: [],
		lines,
		rows,
	};
}

// A divider is one cell thick (a line tall in a column, for its title; a rule wide in a row):
// as wide as it's let be in a column, and in a row as tall as the row (layoutRow stretches it).
function layoutDivider(node, ctx, metrics) {
	const m = marginsOf(node.props);
	const room = Math.max(0, ctx.width - m.left - m.right);
	const own = hasSize(node.props.width) ? resolveSize(node.props.width, room) : room;
	const width = node.vertical ? metrics.ruleX : Math.min(own, room);
	return {
		x: ctx.x + m.left,
		y: ctx.y + m.top,
		width,
		height: Math.min(node.vertical ? metrics.ruleY : metrics.lineHeight, ctx.height),
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
// layers lists them, bottom to top, their x and y on the screen. m, the metrics (metrics.js) it's
// laid out in, cells by default, is kept as the root's metrics.
export function calculateLayout(node, width, height = Infinity, m = cellMetrics) {
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
	const layout = layoutNode(node, screen, m);
	layout.metrics = m;
	layout.layers = fixedNodesOf(node)
		.map((fixed, order) => ({ layer: layoutFixed(fixed, screen, m), order }))
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

function layoutFixed(node, screen, m) {
	const s = node.props;
	const laid = layoutNode(node, { ...screen, x: 0, y: 0 }, m);
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

function layoutNode(node, ctx, m) {
	if (node.type === "text") return layoutText(node, ctx, m);
	if (node.type === "spacer") return layoutSpacer(node, ctx);
	if (node.type === "divider") return layoutDivider(node, ctx, m);
	const style = node.props;
	if (style.display === "none")
		return { x: ctx.x, y: ctx.y, width: 0, height: 0, node, children: [] };

	const pad = paddingOf(style);
	const margins = marginsOf(style);
	const border = borderWidthOf(style);
	const bx = border * m.borderX;
	const by = border * m.borderY;
	// A top border with a title in it is as tall as a line, the title on its line.
	const bt = border && style.borderText ? Math.max(by, m.lineHeight) : by;
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
	const contentWidth = Math.max(0, outerWidth - pad.left - pad.right - bx * 2);
	const contentHeight = Math.max(0, outerHeight - pad.top - pad.bottom - bt - by);

	const direction = style.flexDirection ?? "column";
	const isRow = direction === "row" || direction === "row-reverse";
	const isReverse = direction.endsWith("-reverse");
	// A split box needs a rule's room between its children for each line it draws.
	const split = style.split !== undefined && style.split !== "false";
	const ownGap = nonNegative(
		isRow ? (style.columnGap ?? style.gap) : (style.rowGap ?? style.gap),
		"gap",
	);
	const gap = split ? Math.max(isRow ? m.ruleX : m.ruleY, ownGap) : ownGap;
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
		? layoutRow(ordered, contentWidth, childHeight, gap, style, hasHeight && !scrolls, m)
		: layoutColumn(ordered, contentWidth, childHeight, gap, style, m);

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
			: totalWidth + pad.left + pad.right + bx * 2;
	let height = hasHeight ? explicitHeight : totalHeight + pad.top + pad.bottom + bt + by;
	width = Math.max(width, nonNegative(style.minWidth, "minWidth"));
	height = Math.max(height, nonNegative(style.minHeight, "minHeight"));
	if (maxWidth !== undefined) width = Math.min(width, maxWidth);
	if (maxHeight !== undefined) height = Math.min(height, maxHeight);

	if (isRow && style.alignItems === "stretch") {
		const inner = Math.max(0, height - pad.top - pad.bottom - bt - by);
		for (let i = 0; i < children.length; i++) {
			const childStyle = children[i].node.props;
			if (childStyle.height !== undefined) continue;
			children[i] = stretchHeight(children[i], Math.max(children[i].height, inner), childStyle);
		}
	}

	const room = (size, a, b) => Math.max(0, size - a - b);
	const layoutWidth = Math.max(0, Math.min(width, room(ctx.width, margins.left, margins.right)));
	const layoutHeight = Math.max(0, Math.min(height, room(ctx.height, margins.top, margins.bottom)));
	const innerWidth = layoutWidth - pad.left - pad.right - bx * 2;
	const innerHeight = layoutHeight - pad.top - pad.bottom - bt - by;

	// Absolute children take no space and sit in this box's content area by top/left/right/bottom.
	for (const child of absolute) {
		const s = child.props;
		const laid = layoutNode(child, { x: 0, y: 0, width: contentWidth, height: contentHeight }, m);
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
		x: ctx.x + margins.left,
		y: ctx.y + margins.top,
		width: layoutWidth,
		height: layoutHeight,
		node,
		children,
		border: { top: bt, bottom: by, left: bx, right: bx },
		inset: {
			top: pad.top + bt,
			bottom: pad.bottom + by,
			left: pad.left + bx,
			right: pad.right + bx,
		},
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

function layoutRow(children, width, height, gap, parentStyle, hasExplicitHeight, m) {
	const wrap = parentStyle.flexWrap ?? "nowrap";
	if (wrap !== "nowrap" && children.length > 0) {
		return layoutWrappedRows(children, width, height, gap, parentStyle, hasExplicitHeight, wrap, m);
	}
	let fixedWidth = 0;
	let flexTotal = 0;
	const infos = [];
	for (const child of children) {
		const s = child.props;
		const flex = flexOf(child, s.width);
		const minWidth = nonNegative(s.minWidth, "minWidth");
		const basis =
			s.flexBasis === "content"
				? layoutNode(child, { x: 0, y: 0, width, height }, m).width
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
			const layout = layoutNode(child, { x: 0, y: 0, width: measuredWidth, height }, m);
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
				: layoutNode(info.node, { x: cx, y: 0, width: allocated, height }, m);
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
	m,
) {
	const lines = [];
	let line = [];
	let lineWidth = 0;
	for (const child of children) {
		const s = child.props;
		const { left, right } = marginsOf(s);
		const measured = layoutNode(child, { x: 0, y: 0, width, height }, m);
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
			m,
		);
		return { layouts, height: layouts.reduce((h, l) => Math.max(h, l.y + l.height), 0) };
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

function layoutColumn(children, width, height, gap, parentStyle, m) {
	const results = [];
	if (hasSize(parentStyle.height) && height !== Infinity) {
		let fixedHeight = 0;
		let flexTotal = 0;
		const infos = [];
		for (const child of children) {
			const s = child.props;
			const { top, bottom } = marginsOf(s);
			const flex = flexOf(child, s.height);
			const minHeight = nonNegative(s.minHeight, "minHeight");
			const maxHeight =
				s.maxHeight === undefined ? undefined : nonNegative(s.maxHeight, "maxHeight");
			if (flex > 0) {
				flexTotal += flex;
				fixedHeight += top + bottom;
				infos.push({ node: child, flex, minHeight, maxHeight, top, bottom });
			} else {
				const layout = layoutNode(child, { x: 0, y: 0, width, height }, m);
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
					layout = withBox(layoutNode(info.node, { x: 0, y, width, height: h }, m), { height: h });
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
		const layout = layoutNode(child, { x: 0, y, width, height: height - y }, m);
		results.push(withBox(layout, alignX(layout, width, alignOf(s, parentStyle))));
		y += top + layout.height + bottom + (i < children.length - 1 ? gap : 0);
	});

	const room = parentStyle.height !== undefined && height !== Infinity ? height : y;
	const remaining = Math.max(0, room - y);
	const justify = parentStyle.justifyContent ?? "flex-start";
	if (remaining <= 0 || results.length === 0) return results;
	const offsetOf = justifyOffset(justify, remaining, results.length);
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
		el.place(layout);
	}
	const inset = layout.inset ?? { top: 0, bottom: 0, left: 0, right: 0 };
	const cx = x + inset.left;
	const cy = y + inset.top;
	let top = 0;
	if (own && layout.scrollHeight !== undefined) {
		const w = layout.width - inset.left - inset.right;
		const viewport = { x: cx, y: cy, w, h: layout.clientHeight };
		el.placeScroll(layout.scrollHeight, layout.clientHeight, viewport);
		// Settled, not set: layout clamps it without asking for another paint.
		const max = layout.scrollHeight - layout.clientHeight;
		top = Math.max(0, Math.min(el.scrollTop, max));
		el.settleScroll({ top });
	}
	for (const child of layout.children) absolutize(child, cx, cy - top);
	// Layers are placed on the screen.
	for (const layer of layout.layers ?? []) absolutize(layer, 0, 0);
	return layout;
}
