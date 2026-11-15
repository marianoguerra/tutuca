// Rendering a component's renders.ps: a RenderContext whose target is psTarget, so render,
// renderEach, renderIt and pushView pick the renders.ps of the components they reach, and a
// component without one fails to render.
//
// What a renders.ps renders to, lowered to the drawing it says and checked, as
// src/checked/lower.js does it: every issue at the path of the node it's in
// (Page.children[1].children[0]), thrown as one PsError.

import { checkedLower } from "../checked/lower.js";
import { renderedVNodes } from "../checked/render.js";
import { printPs } from "./print.js";
import { PS, SEGMENT } from "./schema.js";
import { PsError, psTarget } from "./target.js";

// PostScript has no current point before a path's first segment: only these start one.
const STARTS_PATH = new Set(["MoveTo", "Arc"]);
const checkNode = (type, _node, children, path, issues) => {
	if (type !== "Path") return;
	const [first] = children;
	if (first === undefined) issues.push(`${path}: Path has no segments`);
	else if (typeof first !== "string" && !STARTS_PATH.has(first.tag)) {
		issues.push(`${path}: Path starts with a MoveTo or an Arc, not ${first.tag}`);
	}
};

// The drawing the vnodes a renders.ps rendered say: exactly one node, a Document, a Page or a
// Graphic (print.js puts the last two in a document).
const lower = checkedLower(PS, PsError, {
	checkNode,
	isRoot: (type) => !PS.tags[type].is.includes(SEGMENT),
	rootsAre: "a Document, a Page or a Graphic",
});
// The drawing instance's renders.ps (view, or main) renders to; throws a PsError listing what
// isn't a valid drawing.
export const renderPsTree = (instance, { view } = {}) =>
	lower(renderedVNodes(instance, psTarget, view));
// The PostScript program that draws what instance renders.
export const renderPs = (instance, { view } = {}) => printPs(renderPsTree(instance, { view }));
