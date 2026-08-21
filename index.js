import { Macro, ParseContext } from "./src/anode.js";
import { App } from "./src/app.js";
import { Components } from "./src/components.js";
import { Renderer } from "./src/renderer.js";

export { ParseContext } from "./src/anode.js";
export { injectCss } from "./src/app.js";
export { dispatchPhase, phaseOps, resolveArgs } from "./src/on.js";
export { component, FIELD_CLASS } from "./src/oo.js";
export { SEQ_INFO } from "./src/renderer.js";
export { PASS, rootDispatcher } from "./src/transactor.js";
export const css = String.raw;
export const html = String.raw;
export const macro = (defaults, rawView) => new Macro(defaults, rawView);
export function check(_app) {
  return { error: 0, warn: 0, hint: 0, dummyCheck: true };
}
export async function test(_opts) {
  return null;
}
export function collectIterBindings() {
  console.warn(
    "collectIterBindings is a no-op in the core tutuca build; use the tutuca-dev build for a functional implementation",
  );
  return [];
}
export function tutuca(nodeOrSelector) {
  const rootNode =
    typeof nodeOrSelector === "string" ? document.querySelector(nodeOrSelector) : nodeOrSelector;
  const comps = new Components();
  const renderer = new Renderer(comps);
  return new App(rootNode, comps, renderer, ParseContext);
}
