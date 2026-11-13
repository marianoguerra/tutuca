// tutuca/tui: tutuca apps in a terminal. A component's renders.tui says what it renders there (one
// tree, or views by name with a main), as its view (and views) say what it renders on a page.
// It's opt in: enableTargets(tuiTarget) before component() takes one; a module that only declares
// components imports tuiTarget from tutuca/tui/target, without the terminal. Host({ target:
// tuiTarget }) renders them into a terminal DOM (tdom.js), which src/vdom's morph patches and src/core/host/events.js walks as it
// does a page's. Each paint lays out the tree (layout.js), draws it into cells (paint.js,
// buffer.js) and writes what changed.
//
// Elements: <box> lays out its children (flexbox: flexDirection, gap, padding, margin,
// borderStyle, width, height, flexGrow, justifyContent, alignItems, ...), <text> shows its text
// (wrap: wrap, truncate, truncate-start, truncate-middle), <input> its value and edits it when
// focused, <textarea> the same over many lines, <spacer> grows, <divider> draws a line across a
// column or down a row (dividerStyle, char, color, title). A box with split draws a line between
// its children that joins its border. Every tuiuiu border style is a borderStyle (BORDER_STYLES),
// and each side can have its own color and dimming (borderTopColor, borderDimLeft, ...). A box with overflow (or overflowY) scroll or auto is a scroll
// container: its content is as tall as it is, it shows what fits from its scrollTop on, and a
// thumb on its right border says where. Bare text in a box shows as a <text> does. color,
// backgroundColor, bold, dim, italic, underline, inverse and strikethrough style the text in an
// element and its children, and inside a <text>, elements style the part of it they hold, as
// <span>s do (a click on that part reaches them). Attributes are strings, as on a page:
// padding: "1", bold: "true".
//
// Layers: an element with position fixed is laid out against the whole screen (top, left,
// right, bottom), drawn over everything by zIndex and tree order, and not clipped by what it's
// in. One with modal also traps focus: it takes it when it opens, Tab stays in it, the clicks
// outside it are its own, and focus goes back where it was when it closes.
//
// Terminals: runTui reads what the terminal shows from the environment (capabilities.js:
// NO_COLOR, FORCE_COLOR, COLORTERM, TERM and known terminals; the locale), and the output
// reduces colors to 256, 16 or none and draws ASCII for box drawing without Unicode; the cells
// keep the full style.
//
// Events: a click, mousedown, mouseup, mousemove or wheel goes to the element under the cell; a
// keydown to the focused element (an <input>, or anything with focusable). Unless a handler
// prevents it, Tab moves focus (scrolling it into view), Enter and space click, an input or
// textarea edits at its selection (editing.js: Shift selects, Ctrl+A selects all, readline's Ctrl
// keys, Ctrl+Z and Ctrl+Y undo and redo, Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste, a drag
// selects) and sends input as it changes and submit on Enter (Alt+Enter in a textarea), and the wheel,
// the arrows, PageUp, PageDown, Home and End scroll a scroll container. A handler reads the key
// with eventKey(), from tutuca.
//
// Pages: mirrorTui shows another host's state on a Screen and sends its events to that host,
// and web.js draws a Screen's cells as styled text and sends it a page's keys and mouse, without
// a terminal emulator; <tutuca-terminal> (tutuca/tui/element) puts the two together, a terminal
// preview of an app on the page.
//
// The cell buffer, text widths, flexbox, drawing and terminal detection are ported from tuiuiu.js
// (MIT, see LICENSE.tuiuiu).
export {
	asciiOf,
	bufferToAnsi,
	CellBuffer,
	colorToSgr,
	patchesToAnsi,
	reduceStyle,
	sgr,
} from "./buffer.js";
export { detectColors, detectTerminal, detectUnicode } from "./capabilities.js";
export {
	columnIn,
	editKey,
	insert,
	isEditable,
	lineIndexAt,
	linesOf,
	offsetAt,
	redo,
	replace,
	undo,
} from "./editing.js";
export { PASTE_END, PASTE_START, parseInput, parseMouse } from "./input.js";
export {
	absolutize,
	calculateLayout,
	clipsOf,
	layoutTree,
	parseProp,
	propsOf,
	scrollsOf,
} from "./layout.js";
export { BORDER_STYLES, inheritedStyleOf, paint, paintScreen } from "./paint.js";
export { focusables, hitTest, osc52, Screen } from "./screen.js";
export { tuiTarget } from "./target.js";
export { makeEvent, TComment, TDocument, TElement, TFragment, TText } from "./tdom.js";
export { mirrorTui, runTui, startTui } from "./terminal.js";
export {
	caretAtColumn,
	columnOf,
	fitSegments,
	fitText,
	graphemeBounds,
	graphemes,
	graphemeWidth,
	nextBoundary,
	nextWord,
	padText,
	previousBoundary,
	previousWord,
	readGrapheme,
	segmentsText,
	sliceColumns,
	stringWidth,
	stripControls,
	truncateText,
} from "./text.js";
export { bindScreen, drawBuffer, drawRow, keyOf, sgrCss } from "./web.js";
