import { Macro, ParseContext } from "./src/anode.js";
import { App } from "./src/app.js";
import { Components } from "./src/components.js";
import { Renderer } from "./src/renderer.js";
import { h, render, VComment, VFragment } from "./src/vdom.js";

export * from "./deps/immutable.js";
export {
  isMap as isIMap,
  isOrderedMap as isOMap,
  Map as IMap,
  OrderedMap as OMap,
  Set as ISet,
} from "./deps/immutable.js";
export { ParseContext } from "./src/anode.js";
export { injectCss } from "./src/app.js";
export { component, fieldsByClass } from "./src/oo.js";
export { seqInfoByClass } from "./src/renderer.js";
export const css = String.raw;
export const html = String.raw;

export function macro(defaults, rawView) {
  return new Macro(defaults, rawView);
}

const toNode = (nodeOrSelector) =>
  typeof nodeOrSelector === "string" ? document.querySelector(nodeOrSelector) : nodeOrSelector;

export function tutuca(nodeOrSelector) {
  const rootNode = toNode(nodeOrSelector);
  const comps = new Components();
  const fragment = (childs) => new VFragment(childs);
  const comment = (text) => new VComment(text);
  const ropts = { document };
  const render1 = (vnode, cont) => render(vnode, cont, ropts);
  const renderer = new Renderer(comps, h, fragment, comment, render1);
  return new App(rootNode, render1, comps, renderer, ParseContext);
}
