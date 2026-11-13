// What a renders.ps renders to, lowered to the drawing it says and checked, as
// src/checked/lower.js does it: every issue at the path of the node it's in
// (Page.children[1].children[0]), thrown as one PsError.
import { checkedLower } from "../checked/lower.js";
import { PS, SEGMENT } from "./schema.js";
import { PsError } from "./tags.js";

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
export const lower = checkedLower(PS, PsError, {
	checkNode,
	isRoot: (type) => !PS.tags[type].is.includes(SEGMENT),
	rootsAre: "a Document, a Page or a Graphic",
});
