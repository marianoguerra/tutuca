import { Macro, ParseContext } from "./src/anode.js";
import { App } from "./src/app.js";
import { Components } from "./src/components.js";
import { Renderer } from "./src/renderer.js";

export { ParseContext } from "./src/anode.js";
export { injectCss } from "./src/app.js";
export { COMPONENT } from "./src/components.js";
export { SEQ_INFO } from "./src/iteration.js";
export { dispatchPhase, phaseOps, resolveArgs } from "./src/on.js";
export { component } from "./src/oo.js";
// Writes an address down: `path().field("theme")`, the same builder `ctx.at` is.
// A registered path (`registerComponents(comps, { paths })`) takes one.
export { path } from "./src/path.js";
export { PASS, rootDispatcher } from "./src/transactor.js";
export const css = String.raw;
export const html = String.raw;
export const macro = (defaults, rawView) => new Macro(defaults, rawView);
// The dev-only helpers, as no-op stubs: a module that imports them from "tutuca"
// still links against the core build (`tutuca lint` / `render`, a production
// page). Each warns so a stub answering for the real thing is never silent; the
// dev build (tutuca/dev) shadows all three with the real implementations.
const devOnly = (name, result) => {
  console.warn(`${name} is a no-op in the core tutuca build; import tutuca/dev for the real one`);
  return result;
};
export function check(_app) {
  return devOnly("check", { error: 0, warn: 0, hint: 0 });
}
export async function test(_opts) {
  return devOnly("test", null);
}
export function collectIterBindings() {
  return devOnly("collectIterBindings", []);
}
export function tutuca(nodeOrSelector) {
  const rootNode =
    typeof nodeOrSelector === "string" ? document.querySelector(nodeOrSelector) : nodeOrSelector;
  const comps = new Components();
  const renderer = new Renderer(comps);
  return new App(rootNode, comps, renderer, ParseContext);
}
