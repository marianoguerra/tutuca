// A guitar's neck in standard tuning, from a start fret and as many frets as its edit view says,
// that marks notes, each in its color, everywhere they are on the frets it shows.
import { $if, component, each, field, send, sourceKey, t, tag } from "../../src/tutuca.js";
import { labeled, metaFor, numberInput, setNumber } from "../common/card.js";
import { midiName, SHARP_NAMES } from "./theory.js";
import {
	between,
	COLORS,
	markFields,
	markMessage,
	NOTE,
	paintFields,
	paintMessages,
	paintQueries,
	palette,
	toggleMark,
} from "./ui.js";

const { circle, div, g, line, p, svg, text } = tag;

// Standard tuning, as the strings are drawn: the high E on top, the low E at the bottom.
export const TUNING = [64, 59, 55, 50, 45, 40];
const STRING_NAMES = ["e", "B", "G", "D", "A", "E"];
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

// The neck's geometry: a column per fret, a row per string, the frets' numbers under them.
const LEFT = 22;
const COL = 40;
const TOP = 14;
const GAP = 22;
const BOTTOM = TOP + 5 * GAP;
const HEIGHT = BOTTOM + 26;

// Everything a neck from startFret, frets long, draws, as lists of plain items: the strings,
// the fret wires (the nut thick), the inlays, the frets' numbers and every position on every
// string (marked when its pitch class is: marked holds pitch classes, 0 to 11).
export const neckOf = ({ startFret, frets, marked, labels, colors }) => {
	const width = LEFT + frets * COL;
	const columns = Array.from({ length: frets }, (_, c) => ({
		fret: startFret + c,
		x: LEFT + c * COL,
		mid: LEFT + c * COL + COL / 2,
	}));
	const strings = TUNING.map((_, s) => ({
		y: TOP + s * GAP,
		x1: LEFT,
		x2: width,
		name: STRING_NAMES[s],
		labelY: TOP + s * GAP + 4,
		// The low strings are thicker.
		thickness: (0.8 + s * 0.35).toFixed(2),
	}));
	// A wire after each fret: the one after fret 0 is the nut. Without fret 0 shown, a thin line
	// closes the left end.
	const wires = [
		...(startFret === 0 ? [] : [{ x: LEFT, thickness: 1 }]),
		...columns.map(({ fret, x }) => ({ x: x + COL, thickness: fret === 0 ? 5 : 2 })),
	];
	const inlays = columns.flatMap(({ fret, mid }) => {
		if (INLAYS.includes(fret)) return [{ x: mid, y: TOP + 2.5 * GAP }];
		if (fret > 0 && fret % 12 === 0) {
			return [
				{ x: mid, y: TOP + 1.5 * GAP },
				{ x: mid, y: TOP + 3.5 * GAP },
			];
		}
		return [];
	});
	const numbers = columns.map(({ fret, mid }) => ({ x: mid, text: String(fret) }));
	const positions = TUNING.flatMap((open, s) =>
		columns.map(({ fret, mid }) => {
			const midi = open + fret;
			const at = marked.indexOf(midi % 12);
			return {
				string: s,
				fret,
				key: `${s}:${fret}`, // String (0 the high e) and fret, to find it by.
				midi,
				x: mid,
				y: TOP + s * GAP,
				r: at >= 0 ? 9 : 8,
				fill: at >= 0 ? colors[at] || COLORS.note : "transparent",
				stroke: at >= 0 ? "#333" : "none",
				label: at >= 0 ? labels[at] || SHARP_NAMES[midi % 12] : "",
				title: `${midiName(midi)}: ${STRING_NAMES[s]} string, ${fret === 0 ? "open" : `fret ${fret}`}`,
			};
		}),
	);
	return { width, strings, wires, inlays, numbers, positions };
};

const neck = () =>
	svg(
		{
			class: "guitar-neck block h-auto w-full",
			viewBox: field("viewBox"),
			role: "img",
			"aria-label": field("ariaLabel"),
		},
		each(field("inlays"), circle({ cx: field("x"), cy: field("y"), r: "4", fill: "#d1d5db" })),
		each(
			field("wires"),
			line({
				x1: field("x"),
				x2: field("x"),
				y1: String(TOP),
				y2: String(BOTTOM),
				stroke: "#9ca3af",
				"stroke-width": field("thickness"),
			}),
		),
		each(
			field("strings"),
			g(
				line({
					x1: field("x1"),
					x2: field("x2"),
					y1: field("y"),
					y2: field("y"),
					stroke: "#6b7280",
					"stroke-width": field("thickness"),
				}),
				text(
					{
						x: "6",
						y: field("labelY"),
						"font-size": "10",
						"font-family": "sans-serif",
						fill: "currentColor",
					},
					field("name"),
				),
			),
		),
		each(
			field("numbers"),
			text(
				{
					x: field("x"),
					y: String(HEIGHT - 6),
					"text-anchor": "middle",
					"font-size": "10",
					"font-family": "sans-serif",
					fill: "currentColor",
					opacity: "0.6",
				},
				field("text"),
			),
		),
		each(
			field("positions"),
			g(
				{
					class: "fret-position cursor-pointer",
					"data-position": field("key"),
					"on:click": send("pressFret", sourceKey()),
				},
				circle({
					cx: field("x"),
					cy: field("y"),
					r: field("r"),
					fill: field("fill"),
					stroke: field("stroke"),
				}),
				text(
					{
						x: field("x"),
						y: field("y"),
						"text-anchor": "middle",
						"dominant-baseline": "central",
						"font-size": "8",
						"font-family": "sans-serif",
						fill: "#111",
						"pointer-events": "none",
					},
					field("label"),
				),
				tag.title(field("title")),
			),
		),
	);

// A guitar's neck, frets long from startFret: it marks notes (pitch classes) everywhere they
// are, each in its color and with its name. Clicking a position marks its note with the
// palette's paint, or unmarks it, unless it's locked, as it is in a card that marks it.
export const GuitarNeck = component({
	name: "GuitarNeck",
	meta: metaFor(
		"Guitar neck",
		"🎸",
		"A guitar's neck that marks notes: pick its first fret and how many it shows in its edit view.",
		560,
	),
	fields: {
		startFret: t.number().int().min(0).max(22),
		frets: t.number().int().min(1).max(24).default(12),
		...markFields(t.number().int().min(0).max(11)),
		...paintFields(),
		locked: t.boolean(),
	},
	methods: {
		neck() {
			return neckOf(this);
		},
	},
	queries: {
		...paintQueries,
		get viewBox() {
			return `0 0 ${this.neck().width + 4} ${HEIGHT}`;
		},
		get strings() {
			return this.neck().strings;
		},
		get wires() {
			return this.neck().wires;
		},
		get inlays() {
			return this.neck().inlays;
		},
		get numbers() {
			return this.neck().numbers;
		},
		get positions() {
			return this.neck().positions;
		},
		get rangeText() {
			const last = this.startFret + this.frets - 1;
			return this.startFret === 0 ? `Open to fret ${last}` : `Frets ${this.startFret} to ${last}`;
		},
		get ariaLabel() {
			const notes = this.marked.map((pc, i) => this.labels[i] || SHARP_NAMES[pc]);
			return `Guitar neck, ${this.rangeText.toLowerCase()}${notes.length === 0 ? "" : `, marked: ${notes.join(" ")}`}`;
		},
		get paints() {
			return !this.locked;
		},
	},
	view: div({ class: "guitar flex flex-col gap-1" }, $if(field("paints"), palette(), ""), neck()),
	views: {
		edit: div(
			{ class: "guitar flex flex-col gap-2" },
			div(
				{ class: "grid grid-cols-2 gap-2" },
				labeled("Start fret", numberInput("Start fret", "startFret", "setStartFret")),
				labeled("Frets shown", numberInput("Frets shown", "frets", "setFrets")),
			),
			neck(),
			p({ class: NOTE }, field("rangeText")),
		),
	},
	on: {
		setStartFret: setNumber("startFret", between(0, 22)),
		setFrets: setNumber("frets", between(1, 24)),
		pressFret: {
			args: [t.number().int().min(0)],
			run(next, [at]) {
				const position = this.neck().positions[at];
				if (this.locked || position === undefined) return;
				const pc = position.midi % 12;
				toggleMark(this, next, pc, this.marked.indexOf(pc), SHARP_NAMES[pc]);
			},
		},
		...paintMessages,
		...markMessage(t.number().int().min(0).max(11)),
	},
});

export const guitarNeck = (C, { startFret = 0, frets = 13, locked = false } = {}) =>
	C.GuitarNeck({ startFret, frets, marked: [], labels: [], colors: [], locked });
