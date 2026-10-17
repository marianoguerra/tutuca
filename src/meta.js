// The comments tutuca wraps rendered components and loop items in: §{json}§ opens one and §/§
// closes it. Events read them back to find the path of the component they happened in.
import { VComment } from "./vdom.js";

export const META_CLOSE = "§/§";
// One shared closing comment, so morph skips it by identity.
export const META_END = new VComment(META_CLOSE);
export const metaOpen = (meta) => new VComment(`§${JSON.stringify(meta)}§`);
export const isMetaOpen = (text) => text.startsWith("§{") && text.endsWith("§");
// The meta an opening comment's text holds; throws on bad json.
export const parseMeta = (text) => JSON.parse(text.slice(1, -1));
