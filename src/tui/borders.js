// The border styles a box's borderStyle (and a divider's dividerStyle) names, as the characters a
// terminal draws them with: tuiuiu's (utils/types.ts BORDER_STYLES; MIT, see LICENSE.tuiuiu). A
// canvas draws them from these too, as the lines or blocks the characters are.
const border = (tl, tr, bl, br, t, b, l, r) => ({ tl, tr, bl, br, t, b, l, r });
// The styles tuiuiu has under two names.
const HEAVY = border("┏", "┓", "┗", "┛", "━", "━", "┃", "┃");
const ASCII = border("+", "+", "+", "+", "-", "-", "|", "|");
const DOUBLE_EDGE = border("╓", "╖", "╙", "╜", "─", "─", "║", "║");
const TAB = border("▁", "▁", "▔", "▔", "▁", "▔", "▎", "▊");
const BLANK = border(" ", " ", " ", " ", " ", " ", " ", " ");
// All of tuiuiu's border styles, by name; none (no border) isn't one, hidden and blank take the
// space with blanks.
export const BORDER_STYLES = {
	single: border("┌", "┐", "└", "┘", "─", "─", "│", "│"),
	double: border("╔", "╗", "╚", "╝", "═", "═", "║", "║"),
	round: border("╭", "╮", "╰", "╯", "─", "─", "│", "│"),
	bold: HEAVY,
	heavy: HEAVY,
	singleDouble: DOUBLE_EDGE,
	doubleSingle: border("╒", "╕", "╘", "╛", "═", "═", "│", "│"),
	classic: ASCII,
	ascii: ASCII,
	asciiDouble: border("+", "+", "+", "+", "=", "=", "|", "|"),
	markdown: border("|", "|", "|", "|", "-", "-", "|", "|"),
	arrow: border("↘", "↙", "↗", "↖", "↓", "↑", "→", "←"),
	dashed: border("┌", "┐", "└", "┘", "╌", "╌", "╎", "╎"),
	dashedHeavy: border("┏", "┓", "┗", "┛", "╍", "╍", "╏", "╏"),
	heavyHead: border("┎", "┒", "└", "┘", "━", "─", "│", "│"),
	doubleHead: border("╒", "╕", "└", "┘", "═", "─", "│", "│"),
	heavyEdge: border("┍", "┑", "┕", "┙", "─", "─", "┃", "┃"),
	doubleEdge: DOUBLE_EDGE,
	minimal: border("─", "─", "─", "─", "─", "─", " ", " "),
	minimalHeavy: border("━", "━", "━", "━", "━", "━", " ", " "),
	minimalDouble: border("═", "═", "═", "═", "═", "═", " ", " "),
	horizontals: border(" ", " ", " ", " ", "─", "─", " ", " "),
	inner: border("▗", "▖", "▝", "▘", "▄", "▀", "▐", "▌"),
	outer: border("▛", "▜", "▙", "▟", "▀", "▄", "▌", "▐"),
	thick: border("█", "█", "█", "█", "▀", "▄", "█", "█"),
	block: border("▄", "▄", "▀", "▀", "▄", "▀", "█", "█"),
	hkey: border("▔", "▔", "▁", "▁", "▔", "▁", " ", " "),
	vkey: border("▏", "▕", "▏", "▕", " ", " ", "▏", "▕"),
	tall: border("▊", "▎", "▊", "▎", "▔", "▁", "▊", "▎"),
	panel: border("▊", "▎", "▊", "▎", "█", "▁", "▊", "▎"),
	tab: TAB,
	wide: TAB,
	hidden: BLANK,
	blank: BLANK,
};
// Where a split's line meets the border, by the families of styles that have the pieces: down from
// the top, up from the bottom, right from the left, left from the right. Others join with their
// own line.
export const TEES = {
	single: ["┬", "┴", "├", "┤"],
	round: ["┬", "┴", "├", "┤"],
	dashed: ["┬", "┴", "├", "┤"],
	double: ["╦", "╩", "╠", "╣"],
	bold: ["┳", "┻", "┣", "┫"],
	heavy: ["┳", "┻", "┣", "┫"],
	dashedHeavy: ["┳", "┻", "┣", "┫"],
	classic: ["+", "+", "+", "+"],
	ascii: ["+", "+", "+", "+"],
	asciiDouble: ["+", "+", "+", "+"],
};
export const bordersOf = (name) => BORDER_STYLES[name] ?? BORDER_STYLES.single;
