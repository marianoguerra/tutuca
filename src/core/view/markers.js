// The comments tutuca wraps rendered components and loop items in: §{json}§ opens one and §/§
// closes it. Events read them back to find the path of the component they happened in.
import { Frame } from "../../tree/index.js";
import { VComment } from "../../vdom/index.js";

export const MARKER_CLOSE = "§/§";
// One shared closing comment, so morph skips it by identity.
const MARKER_END = new VComment(MARKER_CLOSE);
const open = (marker) => new VComment(`§${JSON.stringify(marker)}§`);
// One shared comment opens every component, too.
const COMPONENT_OPEN = open({ t: "component" });
// node, a component's view, between the comments that say a component rendered here.
export const wrapComponent = (node) => [COMPONENT_OPEN, node, MARKER_END];
// node between the comments that say frame is the path to what's inside.
export const wrapFrame = (frame, node) => [open(frameMarker(frame)), node, MARKER_END];
export const isMarkerOpen = (text) => text.startsWith("§{") && text.endsWith("§");
// The marker an opening comment's text holds; throws on bad json.
export const parseMarker = (text) => JSON.parse(text.slice(1, -1));

// What a marker says, as its json: a component rendered here, { t: "component" }, or a frame of
// the path to what's inside, { t: "frame", p, k, i }, its provider (v name, d depth, k keys),
// keys and item in short form.
const frameMarker = (frame) => {
	const { provider: p } = frame;
	const base = p === null ? null : { v: p.name, d: p.depth, k: p.keys };
	return { t: "frame", p: base, k: frame.keys, i: frame.item };
};
// The frame a frame marker holds.
export const frameOfMarker = ({ p, k, i }) => {
	const provider = p === null ? null : { name: p.v, depth: p.d, keys: p.k };
	return new Frame(k, i, provider);
};
export const isComponentMarker = (marker) => marker?.t === "component";
export const isFrameMarker = (marker) => marker?.t === "frame";
// Whether marker is one of tutuca's: comments from unmanaged DOM can look alike.
export const isTutucaMarker = (marker) => isComponentMarker(marker) || isFrameMarker(marker);
