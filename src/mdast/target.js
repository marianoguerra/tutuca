// tutuca/mdast/target: what a component that renders markdown needs to be declared, without the
// renderer and its printer: mdTarget, to pass to enableTargets before component() takes a
// renders.md, and the md tags it's written with. tutuca/mdast renders and prints it.
import { RenderTarget } from "../core/model/targets.js";

export const mdTarget = new RenderTarget("md");
export { MdAstError, md } from "./tags.js";
