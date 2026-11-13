// tutuca/jsast/target: what a component that renders JavaScript needs to be declared, without
// the renderer and its printer: jsTarget, to pass to enableTargets before component() takes a
// renders.js, and the js tags it's written with. tutuca/jsast renders and prints it.
import { RenderTarget } from "../core/model/targets.js";

export const jsTarget = new RenderTarget("js");
export { JsAstError, js } from "./tags.js";
