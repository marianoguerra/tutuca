// ps: the tag builders of renders.ps, as tag is of views. ps.Rect({ x: 0, y: 0, width: 10,
// height: 10, fill: "#c00" }) is a graphic, its attrs its fields. They're h elements, so field,
// each, render and $if work in them, and the text of a Text is its children: ps.Text({ x, y },
// "Count: ", field("count")). What's checked when they're built, and how, is
// src/checked/tags.js's.
import { SchemaError } from "../checked/schema.js";
import { checkedTags } from "../checked/tags.js";
import { PS } from "./schema.js";

export class PsError extends SchemaError {}
export const ps = checkedTags(PS, PsError);
