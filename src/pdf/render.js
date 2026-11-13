// Rendering a component's renders.ps as a PDF: the drawing tutuca/ps renders, printed by
// printPdf instead of printPs.
import { renderPsTree } from "../ps/render.js";
import { printPdf } from "./print.js";

// The bytes of the PDF that draws what instance renders.ps renders.
export const renderPdf = (instance, { view, fonts } = {}) =>
	printPdf(renderPsTree(instance, { view }), { fonts });
