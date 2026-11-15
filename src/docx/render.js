// Rendering a component's renders.docx: a RenderContext whose target is docxTarget, so render,
// renderEach, renderIt and pushView pick the renders.docx of the components they reach, and a
// component without one fails to render.
//
// What a renders.docx renders to, lowered to the document it says and checked, as
// src/checked/lower.js does it: every issue at the path of the node it's in
// (Section.children[1].children[0]), thrown as one DocxError.

import { checkedLower } from "../checked/lower.js";
import { renderedVNodes } from "../checked/render.js";
import { printDocx } from "./print.js";
import { BLOCK, DOCX } from "./schema.js";
import { DocxError, docxTarget } from "./target.js";

const ROOTS = new Set(["Document", "Section"]);

// The document the vnodes a renders.docx rendered say: exactly one node, a Document, a Section
// or a Block (print.js puts the last two in a document).
const lower = checkedLower(DOCX, DocxError, {
	isRoot: (type) => ROOTS.has(type) || DOCX.tags[type].is.includes(BLOCK),
	rootsAre: "a Document, a Section or a Block",
});
// The document instance's renders.docx (view, or main) renders to; throws a DocxError listing
// what isn't a valid one.
export const renderDocxTree = (instance, { view } = {}) =>
	lower(renderedVNodes(instance, docxTarget, view));
// The bytes of the .docx file of what instance renders.
export const renderDocx = (instance, { view } = {}) =>
	printDocx(renderDocxTree(instance, { view }));
