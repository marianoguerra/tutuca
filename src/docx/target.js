// tutuca/docx/target: what a component that renders a Word document needs to be declared,
// without the renderer and docx: docxTarget, to pass to enableTargets before component() takes a
// renders.docx, and the docx tags it's written with. tutuca/docx renders and prints it.
//
// docx: the tag builders of renders.docx, as tag is of views. docx.Heading({ level: 1 },
// "Todo") is a heading, its attrs its fields. They're h elements, so field, each, render and $if
// work in them, and text in a parent of Inline content is a text node: docx.Paragraph("Count: ",
// docx.Strong(field("count"))). What's checked when they're built, and how, is
// src/checked/tags.js's.

import { SchemaError } from "../checked/schema.js";
import { checkedTags } from "../checked/tags.js";
import { RenderTarget } from "../core/view/targets.js";
import { DOCX } from "./schema.js";

export const docxTarget = new RenderTarget("docx");
export class DocxError extends SchemaError {}
export const docx = checkedTags(DOCX, DocxError);
