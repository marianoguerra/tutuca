import { Macro, ParseContext } from "./src/anode.js";
import { App } from "./src/app.js";
import { Components } from "./src/components.js";
import { Renderer } from "./src/renderer.js";

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
export const macro = (defaults, rawView) => new Macro(defaults, rawView);
export function check(_app) {
  return { error: 0, warn: 0, hint: 0, dummyCheck: true };
}
export function tutuca(nodeOrSelector) {
  const rootNode =
    typeof nodeOrSelector === "string" ? document.querySelector(nodeOrSelector) : nodeOrSelector;
  const comps = new Components();
  const renderer = new Renderer(comps);
  return new App(rootNode, comps, renderer, ParseContext);
}
