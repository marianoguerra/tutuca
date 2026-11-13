// tutuca/ps (experimental): components that render PostScript. A component's renders.ps (one
// tree, or views by name with a main) says what it draws on a printed page, as its view (and
// views) say what it renders on a screen; renderPsTree renders it to a drawing and renderPs
// prints that as a PostScript program (a DSC document a printer, gs or ps2pdf reads).
//
// Rendering PostScript is opt in: enableTargets(psTarget) before component() takes a renders.ps.
// A module that only declares components imports psTarget and ps from tutuca/ps/target, which
// leaves out the renderer and its printer.
//
// Tags are a drawing, not PostScript's operators: Document > Page > Graphics, a Graphic being a
// Group (moved, rotated, scaled, its children stepped by stepX, stepY), Rect, Circle, Line,
// Polyline, Path (of MoveTo, LineTo, CurveTo, Arc, ClosePath) or Text, whose children are its
// text. Coordinates are PostScript's: points, origin at the bottom left, y up. field, $if, each,
// render and pushView work as in views, so a component draws its child components' renders.ps
// where it puts them.
//
//   enableTargets(psTarget);
//   const { Page, Group, Rect, Text } = ps;
//   const Bars = component({
//     name: "Bars",
//     fields: { values: t.array(t.number()) },
//     loops: { bars: { enrich: ({ value }) => ({ height: value * 10 }) } },
//     renders: {
//       ps: Page(
//         { width: 300, height: 200 },
//         Group({ x: 20, y: 20, stepX: 30 },
//           each(field("values"), Rect({ x: 0, y: 0, width: 20, height: lookupBind("height") }),
//             "bars")),
//       ),
//     },
//   });
//   renderPs(Bars.make({ values: [3, 5, 2] })) // "%!PS-Adobe-3.0\n..."
//
// What's checked, against one table (schema.js): what a view says, when it's built (tags.js),
// and the drawing it renders to, when it renders (lower.js, every node, with the path to it).
// Both throw a PsError.

export {
	arcSweep,
	asDocument,
	encloses,
	fontOf,
	groupTransform,
	PAGE_SIZE,
	pageSize,
	paintOf,
	rgbOf,
	textLines,
} from "./drawing.js";
export { lower } from "./lower.js";
export { num, printPs, psString, setColor } from "./print.js";
export { renderPs, renderPsTree } from "./render.js";
export { ALIGNS, GRAPHIC, LINE_CAPS, LINE_JOINS, SCHEMA, SEGMENT } from "./schema.js";
export { PsError, ps, psTarget } from "./target.js";
