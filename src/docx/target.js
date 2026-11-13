// tutuca/docx/target: what a component that renders a Word document needs to be declared,
// without the renderer and docx: docxTarget, to pass to enableTargets before component() takes a
// renders.docx, and the docx tags it's written with. tutuca/docx renders and prints it.
import { RenderTarget } from "../core/model/targets.js";

export const docxTarget = new RenderTarget("docx");
export { DocxError, docx } from "./tags.js";
