// How values print in labels, logs and messages: the tree's (tree/text.js) and a few more.
import { jsonText } from "../../tree/text.js";

export { errorMessage, jsonText, keyText } from "../../tree/text.js";
// s cut to max characters, with an ellipsis when it was longer.
export const truncate = (s, max) => (s.length > max ? `${s.slice(0, max)}…` : s);
// A message's args as a short label: their JSON, comma separated, cut to 80 characters.
export const argsLabel = (args) => truncate(args.map(jsonText).join(", "), 80);
