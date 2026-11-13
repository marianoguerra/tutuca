// A preview of a renders.ps on a page, which can't run PostScript: the drawing renderPsTree
// makes, drawn as SVG the way tutuca/ps prints it (its defaults, PostScript's y up, an Arc's line
// from the current point). Fonts are the browser's look-alikes, so text widths differ a little.
import { PAGE_SIZE } from "../../src/ps/index.js";

const SVG = "http://www.w3.org/2000/svg";
const BLACK = "#000";
const FAMILY = [
	[/^(Times|NewCenturySchlbk|Palatino|Bookman)/, "serif"],
	[/^Courier/, "monospace"],
	[/^ZapfChancery/, "cursive"],
];
const familyOf = (font) => FAMILY.find(([re]) => re.test(font))?.[1] ?? "sans-serif";

const make = (document, tag, attrs = {}) => {
	const node = document.createElementNS(SVG, tag);
	for (const [name, value] of Object.entries(attrs)) {
		if (value !== undefined) node.setAttribute(name, String(value));
	}
	return node;
};

const rad = (deg) => (deg * Math.PI) / 180;
const arcPath = ({ cx, cy, r, from, to, clockwise }, started) => {
	let end = to;
	if (clockwise) while (end > from) end -= 360;
	else while (end < from) end += 360;
	const at = (a) => `${cx + r * Math.cos(rad(a))} ${cy + r * Math.sin(rad(a))}`;
	let d = `${started ? "L" : "M"} ${at(from)}`;
	// An SVG arc is ambiguous past 180°: draw it in halves.
	const steps = Math.max(1, Math.ceil(Math.abs(end - from) / 180));
	for (let i = 1; i <= steps; i++) {
		d += ` A ${r} ${r} 0 0 ${clockwise ? 0 : 1} ${at(from + ((end - from) * i) / steps)}`;
	}
	return d;
};
const pathData = (segments) => {
	let started = false;
	return segments
		.map((s) => {
			const d = {
				moveTo: () => `M ${s.x} ${s.y}`,
				lineTo: () => `L ${s.x} ${s.y}`,
				curveTo: () => `C ${s.x1} ${s.y1} ${s.x2} ${s.y2} ${s.x} ${s.y}`,
				arc: () => arcPath(s, started),
				closePath: () => "Z",
			}[s.type]();
			started = true;
			return d;
		})
		.join(" ");
};

// fill and stroke as tutuca/ps paints them: black fill or stroke when it says neither.
const paint = (node, encloses) => {
	let { fill, stroke } = node;
	if (fill === undefined && stroke === undefined) {
		if (encloses) fill = BLACK;
		else stroke = BLACK;
	}
	return {
		fill: fill ?? "none",
		stroke: stroke ?? "none",
		"stroke-width": node.lineWidth ?? 1,
		"stroke-dasharray": node.dash?.join(" "),
		"stroke-linecap": node.lineCap,
		"stroke-linejoin": node.lineJoin,
	};
};

const ANCHOR = { left: "start", center: "middle", right: "end" };
const draw = (document, node) => {
	switch (node.type) {
		case "group": {
			const { x = 0, y = 0, rotate = 0, scale = 1, stepX = 0, stepY = 0 } = node;
			const { scaleX = scale, scaleY = scale } = node;
			const g = make(document, "g", {
				transform: `translate(${x} ${y}) rotate(${rotate}) scale(${scaleX} ${scaleY})`,
			});
			node.children.forEach((child, i) => {
				const step = make(document, "g", { transform: `translate(${i * stepX} ${i * stepY})` });
				step.append(draw(document, child));
				g.append(step);
			});
			return g;
		}
		case "rect":
			return make(document, "rect", {
				x: node.x,
				y: node.y,
				width: node.width,
				height: node.height,
				...paint(node, true),
			});
		case "circle":
			return make(document, "circle", {
				cx: node.cx,
				cy: node.cy,
				r: node.r,
				...paint(node, true),
			});
		case "line":
			return make(document, "line", {
				x1: node.x1,
				y1: node.y1,
				x2: node.x2,
				y2: node.y2,
				...paint(node, false),
			});
		case "polyline":
			return make(document, node.closed ? "polygon" : "polyline", {
				points: node.points.map((p) => p.join(",")).join(" "),
				...paint(node, node.closed === true),
			});
		case "path":
			return make(document, "path", { d: pathData(node.children), ...paint(node, true) });
		case "text": {
			const size = node.size ?? 12;
			const lineHeight = node.lineHeight ?? size * 1.2;
			const font = node.font ?? "Helvetica";
			// Upright again in the flipped page: y is -y.
			const text = make(document, "text", {
				transform: "scale(1 -1)",
				"font-family": familyOf(font),
				"font-weight": /Bold|Demi/.test(font) ? "bold" : undefined,
				"font-style": /Italic|Oblique/.test(font) ? "italic" : undefined,
				"font-size": size,
				"text-anchor": ANCHOR[node.align ?? "left"],
				fill: node.fill ?? BLACK,
			});
			node.value.split("\n").forEach((line, i) => {
				const span = make(document, "tspan", { x: node.x, y: -(node.y - i * lineHeight) });
				span.textContent = line;
				text.append(span);
			});
			return text;
		}
	}
};

// An SVG per page of tree, a Document, a Page or a Graphic.
export const previewPs = (document, tree) => {
	const doc =
		tree.type === "document"
			? tree
			: { children: [tree.type === "page" ? tree : { type: "page", children: [tree] }] };
	return doc.children.map((page) => {
		const width = page.width ?? doc.width ?? PAGE_SIZE.width;
		const height = page.height ?? doc.height ?? PAGE_SIZE.height;
		const svg = make(document, "svg", {
			viewBox: `0 0 ${width} ${height}`,
			width,
			height,
			class: "ps-page",
		});
		const flipped = make(document, "g", { transform: `translate(0 ${height}) scale(1 -1)` });
		flipped.append(make(document, "rect", { width, height, fill: page.background ?? "#fff" }));
		for (const child of page.children) flipped.append(draw(document, child));
		svg.append(flipped);
		return svg;
	});
};
