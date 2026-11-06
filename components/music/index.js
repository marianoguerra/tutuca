// Music theory as cards to lay out and explain it with: a piano that marks keys and, in its edit
// view, takes how many octaves it has and where it starts; the circle of fifths, each key with
// its relative minor, picking one to see its signature, its scale and its closest keys; an
// interval picker that builds the notes above a root and names the chord they make; and a chord
// explorer that picks a root, a chord, an octave and an inversion and marks them on its piano.
// The piano is in piano.js, the guitar's neck in guitar.js, the note or chord and offset
// selectors and the explorer that shows them on either in select.js, and the theory in
// theory.js, on plain numbers and names.
import {
	AGENT_META,
	agentTool,
	component,
	each,
	field,
	render,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { BADGE, cardClass, cardHeader, metaFor } from "../common/card.js";
import { GuitarNeck, guitarNeck } from "./guitar.js";
import { Piano, piano } from "./piano.js";
import {
	NoteChordSelector,
	noteChordSelector,
	OffsetExplorer,
	OffsetSelector,
	offsetExplorer,
	offsetSelector,
} from "./select.js";
import {
	CHORDS,
	CIRCLE,
	chordNotes,
	chordOfIntervals,
	INTERVALS,
	isNoteName,
	midiOf,
	PICKABLE,
	parseNoteName,
	pcOfName,
	ROOTS,
	scaleOf,
	signatureText,
	sortIntervals,
	spell,
} from "./theory.js";
import {
	COLORS,
	markOn,
	NOTE,
	noteChips,
	octaveStepper,
	outsideText,
	rootPicker,
	rootQueries,
} from "./ui.js";

export {
	GuitarNeck,
	guitarNeck,
	NoteChordSelector,
	noteChordSelector,
	OffsetExplorer,
	OffsetSelector,
	offsetExplorer,
	offsetSelector,
	Piano,
	piano,
};

const { div, g, option, p, path, select, span, svg, text } = tag;

// What a picker of a root, an octave and the notes above them does to its piano: each handler
// changes the fields, then marks notesOf(next) on it.
const remarking = (notesOf, handlers) =>
	Object.fromEntries(
		Object.entries(handlers).map(([name, { run, ...spec }]) => {
			const remark = (self, next) => {
				next.piano = markOn(self.piano, notesOf(next));
			};
			// A pure one gets no ctx, and says so.
			const wrapped = spec.pure
				? function (next, values) {
						run.call(this, next, values);
						remark(this, next);
					}
				: function (next, values, ctx) {
						run.call(this, next, values, ctx);
						remark(this, next);
					};
			return [name, { ...spec, run: wrapped }];
		}),
	);
// A root as an agent names it: C, F♯, Bb.
const rootName = () => t.string().where(isNoteName, "a note name like C, F♯ or Bb");
const pcOfText = (text) => parseNoteName(text).pc;
const MUSIC_PROMPT =
	"Name notes as C, F♯ or Bb (b and # work for ♭ and ♯). Explain the theory in plain words when you change something.";

const rootHandlers = {
	setRoot: {
		args: [t.number().int().min(0).max(11)],
		run(next, [root]) {
			next.root = root;
		},
	},
	shiftOctave: {
		args: [t.number().int()],
		run(next, [by]) {
			next.octave = Math.min(7, Math.max(0, this.octave + by));
		},
	},
};

// The notes above a root: the root, then each interval picked.
export const intervalNotes = ({ root, octave, intervals }) => {
	const name = ROOTS[root].name;
	const base = midiOf(root, octave);
	return ["P1", ...sortIntervals(intervals)].map((interval) => ({
		interval,
		name: spell(name, interval),
		midi: base + INTERVALS[interval].semis,
		semis: INTERVALS[interval].semis,
	}));
};

// Picks a root and intervals above it, and builds the notes they make: spelled, marked on its
// piano and, when they're a chord's, named.
export const IntervalPicker = component({
	name: "IntervalPicker",
	meta: metaFor(
		"Interval picker",
		"📐",
		"Pick a root and intervals, and see the notes they make.",
		480,
		{
			[AGENT_META]: {
				prompt: `Builds notes from a root and intervals above it (m2 M2 m3 M3 P4 A4 P5 m6 M6 m7 M7 P8), spelled by letter, and names the chord they make when they make one. ${MUSIC_PROMPT}`,
				tools: [
					agentTool(
						"set_intervals",
						"message",
						["root", "intervals"],
						"Set the root and the intervals above it.",
					),
					agentTool("shift_octave", "message", ["by"], "Move it up or down by octaves.", {
						target: "shiftOctave",
					}),
				],
			},
		},
	),
	fields: {
		root: t.number().int().min(0).max(11),
		octave: t.number().int().min(0).max(7).default(4),
		intervals: t.array(t.enum(...PICKABLE)),
		piano: t.component("Piano"),
	},
	queries: {
		...rootQueries,
		get summary() {
			const notes = intervalNotes(this)
				.map((n) => `${n.name} (${n.interval})`)
				.join(", ");
			return `Root ${this.rootName}, octave ${this.octave}: ${notes}. ${this.chordText}`;
		},
		get notes() {
			return intervalNotes(this).map((n) => ({
				...n,
				about: `${INTERVALS[n.interval].name}, ${n.semis} semitone${n.semis === 1 ? "" : "s"} up`,
			}));
		},
		get pickable() {
			return PICKABLE.map((key) => {
				const on = this.intervals.includes(key);
				return {
					key,
					cls: `btn btn-xs join-item flex-1 px-0 font-mono ${on ? "btn-secondary" : "bg-base-100"}`,
					pressed: on ? "true" : "false",
					title: `${INTERVALS[key].name} (${INTERVALS[key].semis} semitones)`,
				};
			});
		},
		get chordText() {
			const kind = chordOfIntervals(this.intervals);
			if (kind === null)
				return this.intervals.length === 0
					? "Pick intervals above the root."
					: "Not a chord this knows.";
			const { name, symbol } = CHORDS[kind];
			return `They sound as ${this.rootName} ${name}, ${this.rootName}${symbol}.`;
		},
		get outside() {
			return outsideText(this.piano, intervalNotes(this));
		},
		// The chord the notes make, short, for the header: its symbol and name.
		get chordSymbol() {
			const kind = chordOfIntervals(this.intervals);
			return kind === null ? this.rootName : `${this.rootName}${CHORDS[kind].symbol}`;
		},
		get chordName() {
			const kind = chordOfIntervals(this.intervals);
			if (kind === null)
				return this.intervals.length === 0 ? "pick intervals" : "not a chord this knows";
			return `${this.rootName} ${CHORDS[kind].name}`;
		},
	},
	view: pickerView(),
	views: { edit: pickerView() },
	on: remarking(intervalNotes, {
		...rootHandlers,
		set_intervals: {
			pure: true,
			args: [rootName(), t.array(t.enum(...PICKABLE))],
			run(next, [root, intervals]) {
				next.root = pcOfText(root);
				next.intervals = sortIntervals([...new Set(intervals)]);
			},
		},
		toggleInterval: {
			args: [
				t
					.number()
					.int()
					.min(0)
					.max(PICKABLE.length - 1),
			],
			run(next, [at]) {
				const key = PICKABLE[at];
				next.intervals = this.intervals.includes(key)
					? this.intervals.filter((i) => i !== key)
					: sortIntervals([...this.intervals, key]);
			},
		},
	}),
});
function pickerView() {
	return div(
		{ class: cardClass("music-intervals") },
		cardHeader(
			"Intervals",
			"badge-secondary",
			span({ class: "font-bold text-lg", title: field("chordText") }, field("chordSymbol")),
			span({ class: NOTE }, field("chordName")),
			octaveStepper(),
		),
		rootPicker(),
		div(
			{ class: "join flex w-full", role: "group", "aria-label": "Intervals" },
			each(
				field("pickable"),
				tag.button(
					{
						type: "button",
						class: field("cls"),
						title: field("title"),
						"aria-pressed": field("pressed"),
						"on:click": send("toggleInterval", sourceKey()),
					},
					field("key"),
				),
			),
		),
		noteChips("outside"),
		render(field("piano")),
	);
}

// The inversions of a chord of n notes.
const INVERSIONS = ["Root position", "First inversion", "Second inversion", "Third inversion"];
const INVERSION_SHORT = ["Root", "1st", "2nd", "3rd"];
const chordOf = ({ root, kind, octave, inversion }) =>
	chordNotes(ROOTS[root].name, kind, octave, inversion);

// Picks a chord, its root, octave and inversion, and marks its notes on its piano.
export const ChordExplorer = component({
	name: "ChordExplorer",
	meta: metaFor(
		"Chord explorer",
		"🎼",
		"Pick a chord, its root, octave and inversion, and see its keys on a piano.",
		520,
		{
			[AGENT_META]: {
				prompt: `Shows a chord on a piano: its root, kind (${Object.keys(CHORDS).join(", ")}), octave and inversion (0 for root position, 1 first, 2 second, 3 third for sevenths). ${MUSIC_PROMPT}`,
				tools: [
					agentTool(
						"set_chord",
						"message",
						["root", "kind", "inversion"],
						"Show a chord: its root, kind and inversion.",
					),
					agentTool("shift_octave", "message", ["by"], "Move it up or down by octaves.", {
						target: "shiftOctave",
					}),
				],
			},
		},
	),
	fields: {
		root: t.number().int().min(0).max(11),
		kind: t.enum(...Object.keys(CHORDS)),
		octave: t.number().int().min(0).max(7).default(4),
		inversion: t.number().int().min(0).max(3),
		piano: t.component("Piano"),
	},
	queries: {
		...rootQueries,
		get summary() {
			const notes = chordOf(this)
				.map((n) => `${n.name} (${n.interval})`)
				.join(", ");
			return `${this.symbol}, ${this.chordName}, octave ${this.octave}: ${notes}, from the lowest. ${this.inversionText}`;
		},
		get notes() {
			return chordOf(this).map((n) => ({ ...n, about: INTERVALS[n.interval].name }));
		},
		get symbol() {
			const notes = chordOf(this);
			const slash = this.inversion === 0 ? "" : `/${notes[0].name}`;
			return `${this.rootName}${CHORDS[this.kind].symbol}${slash}`;
		},
		get chordName() {
			return `${this.rootName} ${CHORDS[this.kind].name}`;
		},
		get kinds() {
			return Object.entries(CHORDS).map(([key, { name, symbol }]) => ({
				key,
				text: `${name}${symbol === "" ? "" : ` (${symbol})`}`,
			}));
		},
		get inversions() {
			return CHORDS[this.kind].intervals.map((_, i) => ({
				text: INVERSION_SHORT[i],
				title: INVERSIONS[i],
				cls: `btn btn-xs join-item flex-1 ${i === this.inversion ? "btn-primary" : "bg-base-100"}`,
				pressed: i === this.inversion ? "true" : "false",
			}));
		},
		get inversionText() {
			const notes = chordOf(this);
			return this.inversion === 0
				? `The root, ${this.rootName}, is the lowest note.`
				: `${notes[0].name} is the lowest note: the ${INVERSIONS[this.inversion].toLowerCase()}.`;
		},
		get outside() {
			return outsideText(this.piano, chordOf(this));
		},
	},
	view: explorerView(),
	views: { edit: explorerView() },
	on: remarking(chordOf, {
		...rootHandlers,
		set_chord: {
			pure: true,
			args: [rootName(), t.enum(...Object.keys(CHORDS)), t.number().int().min(0).max(3)],
			pre: (_self, [, kind, inversion]) => inversion < CHORDS[kind].intervals.length,
			why: (_self, [, kind]) =>
				`a ${CHORDS[kind].name} chord has ${CHORDS[kind].intervals.length} notes, so inversions 0 to ${CHORDS[kind].intervals.length - 1}`,
			run(next, [root, kind, inversion]) {
				next.root = pcOfText(root);
				next.kind = kind;
				next.inversion = inversion;
			},
		},
		setKind: {
			args: [t.enum(...Object.keys(CHORDS))],
			run(next, [kind]) {
				next.kind = kind;
				next.inversion = Math.min(this.inversion, CHORDS[kind].intervals.length - 1);
			},
		},
		setInversion: {
			args: [t.number().int().min(0).max(3)],
			run(next, [inversion]) {
				if (inversion < CHORDS[this.kind].intervals.length) next.inversion = inversion;
			},
		},
	}),
});
function explorerView() {
	return div(
		{ class: cardClass("music-chords") },
		cardHeader(
			"Chord",
			"badge-primary",
			span({ class: "font-bold text-lg" }, field("symbol")),
			span({ class: NOTE }, field("chordName")),
			octaveStepper(),
		),
		rootPicker(),
		div(
			{ class: "flex items-center gap-2" },
			select(
				{
					class: "select select-bordered select-sm w-auto",
					"aria-label": "Chord",
					value: field("kind"),
					"on:change": send("setKind", targetValue()),
				},
				each(field("kinds"), option({ value: field("key") }, field("text"))),
			),
			div(
				{ class: "join flex flex-1", role: "group", "aria-label": "Inversion" },
				each(
					field("inversions"),
					tag.button(
						{
							type: "button",
							class: field("cls"),
							title: field("title"),
							"aria-pressed": field("pressed"),
							"on:click": send("setInversion", sourceKey()),
						},
						field("text"),
					),
				),
			),
		),
		noteChips("outside"),
		p({ class: NOTE }, field("inversionText")),
		render(field("piano")),
	);
}

// The circle of fifths' geometry: an outer ring of major keys and an inner one of their
// relative minors, the top wedge C and A minor, each a fifth clockwise from the one before.
const R_OUT = 140;
const R_MID = 98;
const R_IN = 58;
const polar = (r, deg) => {
	const a = (deg * Math.PI) / 180;
	return [(r * Math.cos(a)).toFixed(2), (r * Math.sin(a)).toFixed(2)];
};
const wedge = (i, outer, inner) => {
	const a0 = i * 30 - 105;
	const a1 = a0 + 30;
	const [x0, y0] = polar(outer, a0);
	const [x1, y1] = polar(outer, a1);
	const [x2, y2] = polar(inner, a1);
	const [x3, y3] = polar(inner, a0);
	return `M${x0} ${y0}A${outer} ${outer} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${inner} ${inner} 0 0 0 ${x3} ${y3}Z`;
};
const RING_FILL = {
	selected: COLORS.root,
	relative: "#fcd34d",
	near: "#bae6fd",
	major: "#f8fafc",
	minor: "#e2e8f0",
};
const ringItems = (self, mode, outer, inner) =>
	CIRCLE.map((key, i) => {
		const [lx, ly] = polar((outer + inner) / 2, i * 30 - 90);
		const near = Math.min((i - self.selected + 12) % 12, (self.selected - i + 12) % 12) === 1;
		const role =
			i !== self.selected ? (near ? "near" : mode) : mode === self.mode ? "selected" : "relative";
		const name = mode === "major" ? key.major : `${key.minor}m`;
		return {
			d: wedge(i, outer, inner),
			fill: RING_FILL[role],
			label: name,
			x: lx,
			y: ly,
			size: mode === "major" ? 15 : 11,
			title: `${mode === "major" ? key.major : key.minor} ${mode}`,
		};
	});
const wedgeView = (handler) =>
	g(
		{ class: "fifths-key cursor-pointer", "on:click": send(handler, sourceKey()) },
		path({ d: field("d"), fill: field("fill"), stroke: "#94a3b8", "stroke-width": "1" }),
		text(
			{
				x: field("x"),
				y: field("y"),
				"text-anchor": "middle",
				"dominant-baseline": "central",
				"font-size": field("size"),
				"font-family": "sans-serif",
				fill: "#111",
				"pointer-events": "none",
			},
			field("label"),
		),
		tag.title(field("title")),
	);

// The circle of fifths: pick a key, major on the outside or minor inside, and see its relative
// key (the same signature), the keys next to it (one sharp or flat apart: its dominant and
// subdominant), its signature and its scale.
export const CircleOfFifths = component({
	name: "CircleOfFifths",
	meta: metaFor(
		"Circle of fifths",
		"⭕",
		"The twelve keys, a fifth apart: pick one to see its signature, scale and neighbors.",
		400,
		{
			[AGENT_META]: {
				prompt: `The circle of fifths: the twelve major keys and their relative minors, a fifth apart. Picking a key shows its signature, scale, relative and neighbors (the summary). ${MUSIC_PROMPT}`,
				tools: [
					agentTool(
						"set_key",
						"message",
						["tonic", "mode"],
						"Pick a key: its tonic and major or minor.",
					),
				],
			},
		},
	),
	fields: {
		selected: t.number().int().min(0).max(11),
		mode: t.enum("major", "minor"),
	},
	queries: {
		get majors() {
			return ringItems(this, "major", R_OUT, R_MID);
		},
		get minors() {
			return ringItems(this, "minor", R_MID, R_IN);
		},
		get key() {
			const k = CIRCLE[this.selected];
			return this.mode === "major" ? k.major : k.minor;
		},
		get keyName() {
			return `${this.key} ${this.mode}`;
		},
		get summary() {
			return `${this.keyName}: ${this.signature}. Scale: ${this.scale}. ${this.relative} ${this.neighbors}`;
		},
		get signature() {
			return signatureText(CIRCLE[this.selected].major);
		},
		get scale() {
			return scaleOf(this.key, this.mode).join(" ");
		},
		get relative() {
			const k = CIRCLE[this.selected];
			return this.mode === "major"
				? `Its relative minor, ${k.minor} minor, has the same signature.`
				: `Its relative major, ${k.major} major, has the same signature.`;
		},
		get neighbors() {
			const name = (i) => {
				const k = CIRCLE[(i + 12) % 12];
				return this.mode === "major" ? `${k.major} major` : `${k.minor} minor`;
			};
			return `Its dominant (V) is ${name(this.selected + 1)} and its subdominant (IV) ${name(this.selected - 1)}, each one sharp or flat away.`;
		},
	},
	view: circleView(),
	views: { edit: circleView() },
	on: {
		pickMajor: pick("major"),
		pickMinor: pick("minor"),
		// The key whose tonic sounds as tonic does in mode (F♯ major and G♭ major are one).
		set_key: {
			pure: true,
			args: [rootName(), t.enum("major", "minor")],
			run(next, [tonic, mode]) {
				const pc = pcOfText(tonic);
				next.selected = CIRCLE.findIndex((k) => pcOfName(k[mode]) === pc);
				next.mode = mode;
			},
		},
	},
});
function pick(mode) {
	return {
		args: [t.number().int().min(0).max(11)],
		run(next, [i]) {
			next.selected = i;
			next.mode = mode;
		},
	};
}
function circleView() {
	return div(
		{ class: cardClass("music-fifths") },
		cardHeader("Circle of Fifths", "badge-accent", span({ class: "font-bold" }, field("keyName"))),
		svg(
			{
				class: "fifths block h-auto w-full max-w-sm self-center",
				viewBox: "-145 -145 290 290",
				role: "img",
				"aria-label": "Circle of fifths",
			},
			each(field("majors"), wedgeView("pickMajor")),
			each(field("minors"), wedgeView("pickMinor")),
			text(
				{
					x: "0",
					y: "-6",
					"text-anchor": "middle",
					"font-size": "18",
					"font-weight": "bold",
					"font-family": "sans-serif",
					fill: "currentColor",
				},
				field("key"),
			),
			text(
				{
					x: "0",
					y: "14",
					"text-anchor": "middle",
					"font-size": "11",
					"font-family": "sans-serif",
					fill: "currentColor",
				},
				field("mode"),
			),
		),
		p({ class: "music-signature text-sm" }, field("signature")),
		p(
			{ class: "text-sm" },
			span({ class: `${BADGE} badge-ghost mr-1` }, "Scale"),
			span({ class: "font-mono" }, field("scale")),
		),
		p({ class: NOTE }, field("relative")),
		p({ class: NOTE }, field("neighbors")),
	);
}

export const musicComponents = {
	Piano,
	GuitarNeck,
	CircleOfFifths,
	IntervalPicker,
	ChordExplorer,
	NoteChordSelector,
	OffsetSelector,
	OffsetExplorer,
};

// Each card, made with C: the examples start in E♭, a key with a few flats to spell.
// A picker or an explorer with its piano marked as its fields say.
const marked = (C, make, fields, notesOf) =>
	make({
		...fields,
		piano: markOn(
			piano(C, { startOctave: fields.octave - 1, octaves: 3, locked: true }),
			notesOf(fields),
		),
	});
export const intervalPicker = (C, { root = 3, octave = 4, intervals = ["m3", "P5", "m7"] } = {}) =>
	marked(C, C.IntervalPicker, { root, octave, intervals }, intervalNotes);
export const chordExplorer = (C, { root = 3, kind = "maj7", octave = 4, inversion = 0 } = {}) =>
	marked(C, C.ChordExplorer, { root, kind, octave, inversion }, chordOf);
export const circleOfFifths = (C, { selected = 9, mode = "major" } = {}) =>
	C.CircleOfFifths({ selected, mode });

// What a canvas hole can become, in the music bundle.
export const MUSIC_KINDS = {
	circle: { component: "CircleOfFifths", make: (C) => circleOfFifths(C) },
	intervals: { component: "IntervalPicker", make: (C) => intervalPicker(C) },
	piano: { component: "Piano", make: (C) => piano(C) },
	chords: { component: "ChordExplorer", make: (C) => chordExplorer(C) },
	guitar: { component: "GuitarNeck", make: (C) => guitarNeck(C) },
	noteChord: { component: "NoteChordSelector", make: (C) => noteChordSelector(C) },
	offset: { component: "OffsetSelector", make: (C) => offsetSelector(C) },
	offsetExplorer: { component: "OffsetExplorer", make: (C) => offsetExplorer(C) },
};
