// Picking notes to show: a note or chord selector, an offset selector that moves what the
// selector picks by an interval, and an explorer that shows both, in different colors, on a
// piano or a guitar's neck, as its toggle says.
import {
	apply,
	component,
	each,
	field,
	render,
	send,
	t,
	tag,
	targetValue,
} from "../../src/tutuca.js";
import { cardClass, cardHeader, metaFor } from "../common/card.js";
import { NOTE } from "../common/util.js";
import { guitarNeck } from "./guitar.js";
import { piano } from "./piano.js";
import {
	CHORDS,
	offsetSelection,
	offsetText,
	ROOTS,
	SELECTION_KINDS,
	selectionNotes,
	selectionSymbol,
} from "./theory.js";
import {
	COLORS,
	instrumentField,
	instrumentMessages,
	instrumentQueries,
	instrumentToggle,
	instrumentView,
	pair,
	rootPicker,
	rootQueries,
	SELECT,
} from "./ui.js";

const { div, input, label, option, p, select, span } = tag;

const CHANGED = { notify: ["selectionChanged"] };

// Picks a root and a single note or a chord on it, and tells what holds it, with
// selectionChanged, when that changes.
export const NoteChordSelector = component({
	name: "NoteChordSelector",
	meta: metaFor("Note or chord", "🎵", "Pick a note, or a chord on it.", 420),
	fields: {
		root: t.number().int().min(0).max(11),
		kind: t.enum(...SELECTION_KINDS),
	},
	methods: {
		// Its notes, from the root in octave.
		notes(octave) {
			return selectionNotes(ROOTS[this.root].name, this.kind, octave);
		},
	},
	queries: {
		...rootQueries,
		get symbol() {
			return selectionSymbol(this.rootName, this.kind);
		},
		get kinds() {
			return SELECTION_KINDS.map((key) => ({
				key,
				text: key === "note" ? "Single note" : `${CHORDS[key].name} chord`,
			}));
		},
		get names() {
			return this.notes(4)
				.map((n) => n.name)
				.join(" ");
		},
	},
	view: div(
		{ class: "note-chord-selector flex flex-col gap-2" },
		rootPicker(),
		pair(
			select(
				{
					class: SELECT,
					"aria-label": "Note or chord",
					value: field("kind"),
					"on:change": send("setKind", targetValue()),
				},
				each(field("kinds"), option({ value: field("key") }, field("text"))),
			),
			span(
				{ class: "flex items-baseline gap-2" },
				span({ class: "font-bold" }, field("symbol")),
				span({ class: `${NOTE} font-mono` }, field("names")),
			),
		),
	),
	on: {
		setRoot: {
			args: [t.number().int().min(0).max(11)],
			emits: CHANGED,
			run(next, [root], ctx) {
				next.root = root;
				ctx.notify("selectionChanged");
			},
		},
		setKind: {
			args: [t.enum(...SELECTION_KINDS)],
			emits: CHANGED,
			run(next, [kind], ctx) {
				next.kind = kind;
				ctx.notify("selectionChanged");
			},
		},
	},
});

// The notes of a selection and of the same one offset, in octave, as { base, moved, root }.
const offsetNotes = (selector, offset, octave) => {
	const moved = offsetSelection(selector.root, selector.kind, octave, offset, ROOTS);
	return { base: selector.notes(octave), moved: moved.notes, root: moved.root };
};
const chip = (cls) =>
	span(
		{ class: `${cls} flex items-center gap-1 rounded border border-base-300 px-2 py-0.5` },
		span({ class: "inline-block size-3 rounded-full", style: field("style") }),
		span({ class: "font-bold" }, field("name")),
		span({ class: "font-mono text-xs opacity-60" }, field("interval")),
	);
const chips = (notes, colors) =>
	notes.map((n) => ({
		name: n.name,
		interval: n.interval,
		style: `background:${n.interval === "P1" ? colors[0] : colors[1]}`,
	}));

// A note or chord and an offset in semitones (-12 to 12) that moves it: what it picks and where
// that moves to, each in its colors. Tells what holds it when either changes.
export const OffsetSelector = component({
	name: "OffsetSelector",
	meta: metaFor(
		"Note and offset",
		"↕️",
		"Pick a note or chord and move it by an interval with a slider.",
		440,
	),
	fields: {
		selector: t.component("NoteChordSelector"),
		offset: t.number().int().min(-12).max(12),
	},
	methods: {
		notes(octave) {
			return offsetNotes(this.selector, this.offset, octave);
		},
	},
	queries: {
		get offsetText() {
			return offsetText(this.offset);
		},
		get movedSymbol() {
			return selectionSymbol(this.notes(4).root, this.selector.kind);
		},
		get baseChips() {
			return chips(this.notes(4).base, [COLORS.root, COLORS.note]);
		},
		get movedChips() {
			return chips(this.notes(4).moved, [COLORS.offsetRoot, COLORS.offset]);
		},
	},
	view: div(
		{ class: "offset-selector flex flex-col gap-2" },
		render(field("selector")),
		label(
			{ class: "flex flex-col gap-1 text-xs" },
			span(
				span({ class: "opacity-80" }, "Interval offset: "),
				span({ class: "font-semibold" }, field("offsetText")),
			),
			input({
				type: "range",
				min: "-12",
				max: "12",
				step: "1",
				class: "range range-xs",
				"aria-label": "Interval offset",
				value: field("offset"),
				"on:input": send("setOffset", targetValue()),
			}),
		),
		div(
			{ class: "flex flex-wrap items-center gap-1 text-sm" },
			each(field("baseChips"), chip("offset-base")),
			span({ class: "px-1 opacity-60" }, "→"),
			each(field("movedChips"), chip("offset-moved")),
		),
	),
	on: {
		setOffset: {
			args: [t.string()],
			emits: CHANGED,
			run(next, [text], ctx) {
				const n = Number(text);
				if (!Number.isInteger(n) || n < -12 || n > 12) return;
				next.offset = n;
				ctx.notify("selectionChanged");
			},
		},
	},
});

// The marks of base and moved notes, by key (a MIDI number on a piano, a pitch class on a
// guitar), as mark takes them: the base in amber (its root) and blue, the moved in dark and
// light pink, and a note in both in violet.
export const marksOf = ({ base, moved }, keyOf) => {
	const marks = new Map();
	for (const n of base) {
		const key = keyOf(n.midi);
		if (!marks.has(key)) {
			marks.set(key, {
				label: n.name,
				color: n.interval === "P1" ? COLORS.root : COLORS.note,
				base: true,
			});
		}
	}
	for (const n of moved) {
		const key = keyOf(n.midi);
		const had = marks.get(key);
		if (had === undefined) {
			marks.set(key, {
				label: n.name,
				color: n.interval === "P1" ? COLORS.offsetRoot : COLORS.offset,
				base: false,
			});
		} else if (had.base) had.color = COLORS.both;
	}
	const keys = [...marks.keys()];
	return [keys, keys.map((k) => marks.get(k).label), keys.map((k) => marks.get(k).color)];
};
const OCTAVE = 4;
const pitchClass = (midi) => ((midi % 12) + 12) % 12;
// The piano and the guitar with the picker's notes marked on them.
const marked = (picker, piano, guitar) => {
	const notes = picker.notes(OCTAVE);
	return {
		piano: apply(piano, "mark", ...marksOf(notes, (m) => m)),
		guitar: apply(guitar, "mark", ...marksOf(notes, pitchClass)),
	};
};

// A note or chord and an offset, shown on a piano or a guitar's neck, as its toggle says: the
// note or chord in amber (its root) and blue, where the offset moves it in pink, and a note in
// both in violet.
export const OffsetExplorer = component({
	name: "OffsetExplorer",
	meta: metaFor(
		"Offset explorer",
		"🎚️",
		"A note or chord and an interval offset, shown on a piano or a guitar in their colors.",
		600,
	),
	fields: {
		picker: t.component("OffsetSelector"),
		...instrumentField(),
		piano: t.component("Piano"),
		guitar: t.component("GuitarNeck"),
	},
	queries: {
		get symbol() {
			return this.picker.selector.symbol;
		},
		...instrumentQueries,
		get legend() {
			const { kind } = this.picker.selector;
			const items = [
				[COLORS.root, `${this.picker.selector.symbol} (root)`],
				[COLORS.note, kind === "note" ? "" : this.picker.selector.symbol],
				[COLORS.offsetRoot, `${this.picker.movedSymbol} (root)`],
				[COLORS.offset, kind === "note" ? "" : this.picker.movedSymbol],
				[COLORS.both, "In both"],
			];
			return items
				.filter(([, text]) => text !== "")
				.map(([color, text]) => ({ style: `background:${color}`, text }));
		},
	},
	view: explorerView(),
	views: { edit: explorerView() },
	on: {
		// What the picker tells when it changes: mark its notes again.
		selectionChanged: {
			args: [],
			run(next, _args, ctx) {
				ctx.stopNext();
				Object.assign(next, marked(this.picker, this.piano, this.guitar));
			},
		},
		...instrumentMessages,
	},
});
function explorerView() {
	return div(
		{ class: cardClass("music-offset") },
		cardHeader("Offset", "badge-secondary", span({ class: "font-bold" }, field("symbol"))),
		render(field("picker")),
		pair(
			instrumentToggle(),
			div(
				{ class: "flex flex-wrap gap-2 text-xs" },
				each(
					field("legend"),
					span(
						{ class: "flex items-center gap-1" },
						span({ class: "inline-block size-3 rounded-full", style: field("style") }),
						field("text"),
					),
				),
			),
		),
		instrumentView(),
		p({ class: NOTE }, "Edit it to set the piano's octaves or the neck's frets."),
	);
}

// Each card, made with C: the examples pick an E♭ major seventh, moved a fifth up.
export const noteChordSelector = (C, { root = 3, kind = "maj7" } = {}) =>
	C.NoteChordSelector({ root, kind });
export const offsetSelector = (C, { offset = 7, ...selected } = {}) =>
	C.OffsetSelector({ selector: noteChordSelector(C, selected), offset });
export const offsetExplorer = (C, { instrument = "piano", ...picked } = {}) => {
	const picker = offsetSelector(C, picked);
	return C.OffsetExplorer({
		picker,
		instrument,
		...marked(
			picker,
			piano(C, { startOctave: 3, octaves: 3, locked: true }),
			guitarNeck(C, { startFret: 0, frets: 13, locked: true }),
		),
	});
};
