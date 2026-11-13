// tutuca/pdf (experimental): components as PDFs. A PDF draws what a component's renders.ps says
// (tutuca/ps: Pages of Groups, Rects, Circles, Lines, Polylines, Paths and Texts), as
// tutuca/ps prints it as PostScript: one drawing, two printers. There's no pdf target to enable:
// enableTargets(psTarget), and renders.ps, are what a component needs.
//
//   const bytes = await renderPdf(instance); // a Uint8Array, %PDF-1.3...
//   new Blob([bytes], { type: "application/pdf" })
//
// It's made with PDFKit, in browsers and node alike. Text is in the 14 fonts every PDF reader
// has, or in ones given by name: renderPdf(instance, { fonts: { Inter: bytes } }) embeds them,
// for Text({ font: "Inter" }).
export { printPdf, STANDARD_FONTS } from "./print.js";
export { renderPdf } from "./render.js";
