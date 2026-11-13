// What a renders.docx renders to, lowered to the document it says and checked, as
// src/checked/lower.js does it: every issue at the path of the node it's in
// (Section.children[1].children[0]), thrown as one DocxError.
import { checkedLower } from "../checked/lower.js";
import { BLOCK, DOCX } from "./schema.js";
import { DocxError } from "./tags.js";

const ROOTS = new Set(["Document", "Section"]);

// The document the vnodes a renders.docx rendered say: exactly one node, a Document, a Section
// or a Block (print.js puts the last two in a document).
export const lower = checkedLower(DOCX, DocxError, {
	isRoot: (type) => ROOTS.has(type) || DOCX.tags[type].is.includes(BLOCK),
	rootsAre: "a Document, a Section or a Block",
});
