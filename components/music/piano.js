// A piano, as many octaves as its edit view says from the octave it says, that marks keys,
// each in its color and with its note's name.

import { AGENT_META, agentTool } from "../../src/meta/index.js";
import { $if, component, each, field, send, sourceKey, t, tag } from "../../src/tutuca.js";
import { labeled, numberInput, setNumber } from "../common/card.js";
import { metaFor } from "../common/meta.js";
import { NOTE } from "../common/util.js";
import { isBlack, midiName, midiOf, SHARP_NAMES } from "./theory.js";
import {
	agentMarkMessages,
	agentMarkTools,
	between,
	COLOR_NAMES,
	COLORS,
	markFields,
	markMessage,
	paintFields,
	paintMessages,
	paintQueries,
	palette,
	toggleMark,
} from "./ui.js";

const { div, g, p, rect, svg, text } = tag;

// The piano's geometry: white keys and the black ones over them.
const WHITE_W = 24;
const WHITE_H = 112;
const BLACK_W = 14;
const BLACK_H = 70;

// The keys of a piano from octave startOctave, octaves long and up to the C after, as
// { midi, x, width, height, fill, label, ... }, the white ones and the black ones apart (the
// black go on top). A marked key has its mark's color and label.
export const pianoKeys = ({ startOctave, octaves, marked, labels, colors }) => {
	const lo = midiOf(0, startOctave);
	const whites = [];
	const blacks = [];
	for (let midi = lo; midi <= lo + 12 * octaves; midi++) {
		const at = marked.indexOf(midi);
		const black = isBlack(midi);
		const fill = at >= 0 ? colors[at] || COLORS.note : black ? "#222" : "#fff";
		const x = black ? whites.length * WHITE_W - BLACK_W / 2 : whites.length * WHITE_W;
		const width = black ? BLACK_W : WHITE_W;
		const height = black ? BLACK_H : WHITE_H;
		// A marked key says its note; an unmarked C says its octave, faintly.
		const isC = midi % 12 === 0;
		const label = at >= 0 ? labels[at] || SHARP_NAMES[midi % 12] : isC ? midiName(midi) : "";
		(black ? blacks : whites).push({
			midi,
			x,
			width,
			height,
			fill,
			label,
			labelX: x + width / 2,
			labelY: height - 7,
			labelFill: at >= 0 || black ? "#111" : "#9ca3af",
			labelSize: black ? 7 : 9,
			title: `${midiName(midi)} (MIDI ${midi})`,
		});
	}
	return { whites, blacks, width: whites.length * WHITE_W };
};

const keyView = (handler) =>
	g(
		{ class: "piano-key cursor-pointer", "on:click": send(handler, sourceKey()) },
		rect({
			x: field("x"),
			y: "0",
			width: field("width"),
			height: field("height"),
			rx: "2",
			fill: field("fill"),
			stroke: "#555",
			"stroke-width": "1",
		}),
		text(
			{
				x: field("labelX"),
				y: field("labelY"),
				"text-anchor": "middle",
				"font-size": field("labelSize"),
				"font-family": "sans-serif",
				fill: field("labelFill"),
				"pointer-events": "none",
			},
			field("label"),
		),
		// A tooltip with the key's name and MIDI number.
		tag.title(field("title")),
	);
const keyboard = () =>
	svg(
		{
			class: "piano-keys block h-auto w-full",
			viewBox: field("viewBox"),
			role: "img",
			"aria-label": field("ariaLabel"),
		},
		each(field("whites"), keyView("pressWhite")),
		each(field("blacks"), keyView("pressBlack")),
	);

// A piano, octaves long from startOctave, that marks keys with their notes' names, each in its
// color. Clicking a key marks it with the palette's paint, or unmarks it, unless it's locked,
// as it is in a card that marks it.
export const Piano = component({
	name: "Piano",
	meta: metaFor("Piano", "🎹", "A piano that marks keys: pick its octaves in its edit view.", 420, {
		[AGENT_META]: {
			prompt: `A piano keyboard that marks keys. Name notes with their octave (C4 is middle C; without one, octave 4). Colors: ${COLOR_NAMES}. The summary is its range and what's marked.`,
			summary: "ariaLabel",
			tools: [
				...agentMarkTools("on the keys"),
				agentTool(
					"set_range",
					"message",
					["startOctave", "octaves"],
					"Show octaves octaves from startOctave.",
				),
			],
		},
	}),
	fields: {
		startOctave: t.number().int().min(0).max(8).default(3),
		octaves: t.number().int().min(1).max(7).default(2),
		...markFields(t.number().int()),
		...paintFields(),
		locked: t.boolean(),
	},
	methods: {
		keys() {
			return pianoKeys(this);
		},
	},
	queries: {
		...paintQueries,
		get whites() {
			return this.keys().whites;
		},
		get blacks() {
			return this.keys().blacks;
		},
		get viewBox() {
			return `-1 -1 ${this.keys().width + 2} ${WHITE_H + 2}`;
		},
		get range() {
			const lo = midiOf(0, this.startOctave);
			return { lo, hi: lo + 12 * this.octaves };
		},
		get rangeText() {
			const { lo, hi } = this.range;
			return `${midiName(lo)} to ${midiName(hi)}`;
		},
		get ariaLabel() {
			const notes = this.marked.map((m, i) => this.labels[i] || midiName(m));
			return `Piano, ${this.rangeText}${notes.length === 0 ? "" : `, marked: ${notes.join(" ")}`}`;
		},
		get paints() {
			return !this.locked;
		},
	},
	view: div(
		{ class: "piano flex flex-col gap-1" },
		$if(field("paints"), palette(), ""),
		keyboard(),
	),
	views: {
		edit: div(
			{ class: "piano flex flex-col gap-2" },
			div(
				{ class: "grid grid-cols-2 gap-2" },
				labeled("Octaves", numberInput("Octaves", "octaves", "setOctaves")),
				labeled("Starts at octave", numberInput("Starts at octave", "startOctave", "setStart")),
			),
			keyboard(),
			p({ class: NOTE }, field("rangeText")),
		),
	},
	on: {
		setOctaves: setNumber("octaves", between(1, 7)),
		setStart: setNumber("startOctave", between(0, 8)),
		pressWhite: pressKey("whites"),
		pressBlack: pressKey("blacks"),
		...paintMessages,
		...markMessage(t.number().int()),
		...agentMarkMessages((note) => midiOf(note.pc, note.octave ?? 4)),
		set_range: {
			pure: true,
			args: [t.number().int().min(0).max(8), t.number().int().min(1).max(7)],
			run(next, [startOctave, octaves]) {
				next.startOctave = startOctave;
				next.octaves = octaves;
			},
		},
	},
});
function pressKey(list) {
	return {
		args: [t.number().int().min(0)],
		run(next, [at]) {
			const key = this.keys()[list][at];
			if (this.locked || key === undefined) return;
			toggleMark(this, next, key.midi, this.marked.indexOf(key.midi), SHARP_NAMES[key.midi % 12]);
		},
	};
}

export const piano = (C, { startOctave = 3, octaves = 2, locked = false } = {}) =>
	C.Piano({ startOctave, octaves, marked: [], labels: [], colors: [], locked });
