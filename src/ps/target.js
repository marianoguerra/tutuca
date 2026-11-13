// tutuca/ps/target: what a component that renders PostScript needs to be declared, without the
// renderer and its printer: psTarget, to pass to enableTargets before component() takes a
// renders.ps, and the ps tags it's written with. tutuca/ps renders and prints it.
import { RenderTarget } from "../core/model/targets.js";

export const psTarget = new RenderTarget("ps");
export { PsError, ps } from "./tags.js";
