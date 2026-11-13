// md: the tag builders of renders.md, as tag is of views. md.Heading({ depth: 1 }, ...children)
// is an mdast node, its attrs the node's fields other than children. They're h elements, so
// field, each, render and $if work in them, and text in a Phrasing parent is a text node:
// md.Paragraph("Count: ", md.Strong(field("count"))). What's checked when they're built, and
// how, is src/checked/tags.js's.
import { SchemaError } from "../checked/schema.js";
import { checkedTags } from "../checked/tags.js";
import { MD } from "./schema.js";

export class MdAstError extends SchemaError {}
export const md = checkedTags(MD, MdAstError);
