// What a renders.md renders to, lowered to the mdast it says and checked, as src/checked/lower.js
// does it: every issue at the path of the node it's in (Root.children[1].children[0]), thrown as
// one MdAstError.
import { checkedLower } from "../checked/lower.js";
import { MD } from "./schema.js";
import { MdAstError } from "./tags.js";

// What a tag may leave out that the printer reads as something else: a list or item without
// spread is printed loose, a blank line between its items.
const DEFAULTS = { List: { spread: false }, ListItem: { spread: false } };

// The mdast the vnodes a renders.md rendered say: exactly one node.
export const lower = checkedLower(MD, MdAstError, { defaults: DEFAULTS });
