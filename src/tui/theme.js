// What a terminal preview on a page is drawn in, unless the page says otherwise: the colors of
// <tutuca-terminal> and <tutuca-canvas>, and what a CanvasPainter draws with by default.

// xterm's dark palette, near enough, for the 16 colors; a page sets the variables to theme it.
export const PALETTE = [
	"#1e1e1e",
	"#cd3131",
	"#0dbc79",
	"#e5e510",
	"#2472c8",
	"#bc3fbc",
	"#11a8cd",
	"#e5e5e5",
	"#666666",
	"#f14c4c",
	"#23d18b",
	"#f5f543",
	"#3b8eea",
	"#d670d6",
	"#29b8db",
	"#ffffff",
];
export const DEFAULT_THEME = Object.freeze({
	fg: "#d4d4d4",
	bg: "#1e1e1e",
	palette: Object.freeze([...PALETTE]),
});
