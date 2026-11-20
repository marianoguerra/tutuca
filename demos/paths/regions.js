// What the marker comments in a rendered app cover: a region per opening comment, with the
// path the markers around it describe, read as events read them (pathOfMarkers). The tour
// outlines regions over the app, in a layer of its own: the app's DOM is the vdom's.
import { pathOfMarkers } from "../../src/core/host/events.js";
import {
	isComponentMarker,
	isMarkerOpen,
	isTutucaMarker,
	MARKER_CLOSE,
	parseMarker,
	providedNameOf,
	providesOfMarker,
} from "../../src/core/view/markers.js";
import { jsonText, keyText } from "../../src/tree/text.js";

const SHOW_COMMENT = 128;
const FOLLOWING = 4;
const PRECEDING = 2;

// The path helpers are the trail's (components/trail/paths.js): the tour's regions use them.
import { frameText, pathKey, pathLabel } from "../../components/trail/paths.js";

export { frameText, pathKey, pathLabel };

// What a marker says, in a few words.
export const markerLabel = (marker) => {
	if (isComponentMarker(marker)) {
		const provides = providesOfMarker(marker);
		return provides === null
			? "component"
			: `component, provides ${Object.keys(provides).join(", ")}`;
	}
	const name = providedNameOf(marker);
	const keys = `${marker.k.map(keyText).join("")}${marker.i === null ? "" : `[${jsonText(marker.i)}]`}`;
	return `frame ${name === null ? "" : `*${name}`}${keys}`;
};

// The regions under rootNode, outermost first: { marker, open, close, parent, depth, path, key }.
export const scanRegions = (rootNode) => {
	const walker = rootNode.ownerDocument.createTreeWalker(rootNode, SHOW_COMMENT);
	const regions = [];
	const stack = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const { data } = node;
		if (data === MARKER_CLOSE) {
			const region = stack.pop();
			if (region !== undefined) region.close = node;
			continue;
		}
		if (!isMarkerOpen(data)) continue;
		let marker;
		try {
			marker = parseMarker(data);
		} catch {
			continue;
		}
		if (!isTutucaMarker(marker)) continue;
		const region = {
			marker,
			open: node,
			close: null,
			parent: stack.at(-1) ?? null,
			depth: stack.length,
		};
		stack.push(region);
		regions.push(region);
	}
	for (const region of regions) {
		region.path = pathOfMarkers(chainFrom(region).map((r) => r.marker));
		region.key = pathKey(region.path);
	}
	return regions;
};
// region and the ones around it, innermost first.
const chainFrom = (region) => {
	const chain = [];
	for (let r = region; r !== null; r = r.parent) chain.push(r);
	return chain;
};
// The regions node is in, innermost first: the markers an event on it walks up through.
export const chainOf = (regions, node) => {
	const inside = regions.filter(
		({ open, close }) =>
			close !== null &&
			(open.compareDocumentPosition(node) & FOLLOWING) !== 0 &&
			(close.compareDocumentPosition(node) & PRECEDING) !== 0,
	);
	return inside.sort((a, b) => b.depth - a.depth);
};
// The outermost region of each path among regions with key.
export const regionsAt = (regions, key) => {
	const found = regions.filter((r) => r.key === key);
	return found.filter((r) => r.parent === null || r.parent.key !== key);
};

// Where a region is on the page; null where the page has no layout (a test's).
const rectOf = ({ open, close }) => {
	if (close === null) return null;
	const range = open.ownerDocument.createRange();
	range.setStartAfter(open);
	range.setEndBefore(close);
	return rectOrNull(range);
};
export const rectOrNull = (thing) => {
	if (typeof thing.getBoundingClientRect !== "function") return null;
	const rect = thing.getBoundingClientRect();
	return rect.width === 0 && rect.height === 0 ? null : rect;
};

// What the layers are drawn with, margaui's classes: a box's by its kind, and its chip's.
const LAYER = "absolute inset-0 pointer-events-none";
const BOX = "absolute box-border rounded-md";
const BOXES = {
	marker: "border border-dashed border-info/60",
	hover: "border-2 border-info bg-info/10",
	target: "border-2 border-primary ring-4 ring-primary/30",
	walk: "border border-warning/60",
	"walk-now": "border-2 border-warning bg-warning/10",
};
const CHIP =
	"absolute -top-2.5 left-1.5 px-1 rounded text-white font-mono text-[0.65rem] leading-4 whitespace-nowrap";
const CHIPS = { marker: "bg-info/75", "walk-now": "bg-warning" };
const CHIP_REST = "bg-info";
// Every class a layer can have, for the page's class compiler.
export const layerClasses = [
	LAYER,
	BOX,
	CHIP,
	CHIP_REST,
	...Object.values(BOXES),
	...Object.values(CHIPS),
];

// A layer of boxes over pane, an element the app is in. draw(boxes) replaces them: each is
// { rect, kind, label, grow }, rect a page rect, grow how far outside it the box is drawn, so
// regions around the same nodes show one around the other.
export const boxLayer = (pane, name) => {
	const layer = pane.ownerDocument.createElement("div");
	layer.className = `tour-layer-${name} ${LAYER}`;
	pane.append(layer);
	const draw = (boxes) => {
		const origin = pane.getBoundingClientRect();
		const nodes = [];
		for (const { rect, kind, label = "", grow = 0 } of boxes) {
			if (rect === null) continue;
			const box = pane.ownerDocument.createElement("div");
			box.className = `${BOX} ${BOXES[kind]}`;
			box.style.left = `${rect.left - origin.left + pane.scrollLeft - grow}px`;
			box.style.top = `${rect.top - origin.top + pane.scrollTop - grow}px`;
			box.style.width = `${rect.width + 2 * grow}px`;
			box.style.height = `${rect.height + 2 * grow}px`;
			if (label !== "") {
				const chip = pane.ownerDocument.createElement("span");
				chip.className = `${CHIP} ${CHIPS[kind] ?? CHIP_REST}`;
				chip.textContent = label;
				box.append(chip);
			}
			nodes.push(box);
		}
		layer.replaceChildren(...nodes);
	};
	return { draw, clear: () => layer.replaceChildren() };
};
// A component region right inside the frame that reaches it: they cover the same nodes.
const isInFrame = (region) =>
	isComponentMarker(region.marker) &&
	region.parent !== null &&
	!isComponentMarker(region.parent.marker) &&
	region.parent.key === region.key;
// The boxes of regions, each with its marker's label, the outer ones drawn further out. A
// frame and the component it reaches, when both are among them, are one box.
export const regionBoxes = (regions, kind, labelled = true) => {
	const listed = new Set(regions);
	const folded = (region) => isInFrame(region) && listed.has(region.parent);
	const levelOf = (region) => {
		let level = 0;
		for (let r = region.parent; r !== null; r = r.parent) if (!folded(r)) level++;
		return level;
	};
	const shown = regions.filter((region) => !folded(region));
	const deepest = shown.reduce((max, region) => Math.max(max, levelOf(region)), 0);
	return shown.map((region) => {
		const inside = regions.find((r) => r.parent === region && folded(r));
		const label = `${markerLabel(region.marker)}${inside === undefined ? "" : ` → ${markerLabel(inside.marker)}`}`;
		return {
			rect: rectOf(region),
			kind,
			label: labelled ? label : "",
			grow: 2 + 4 * Math.min(6, deepest - levelOf(region)),
		};
	});
};
