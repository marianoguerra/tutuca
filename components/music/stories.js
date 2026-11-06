import { step, stories } from "../../src/storybook/index.js";
import { $if, component, field, pushView, render, send, t, tag } from "../../src/tutuca.js";
import {
	chordExplorer,
	circleOfFifths,
	guitarNeck,
	intervalPicker,
	musicComponents,
	noteChordSelector,
	offsetExplorer,
	offsetSelector,
	piano,
} from "./index.js";
import { COLORS } from "./ui.js";

const { button, div } = tag;

// A card with a toggle that pushes its edit view, as a canvas item's does.
const Editable = component({
	name: "MusicEditable",
	fields: { content: t.component(), editing: t.boolean() },
	queries: {
		get pushed() {
			return this.editing ? "edit" : "main";
		},
		get toggleLabel() {
			return this.editing ? "Use it" : "Edit it";
		},
	},
	view: div(
		{ class: "flex max-w-xl flex-col items-start gap-2" },
		button(
			{
				class: "btn btn-xs",
				title: field("toggleLabel"),
				"aria-pressed": $if(field("editing"), "true", "false"),
				"on:click": send("toggle"),
			},
			field("toggleLabel"),
		),
		div({ class: "w-full" }, pushView(field("pushed"), render(field("content")))),
	),
	on: {
		toggle(next) {
			next.editing = !this.editing;
		},
	},
});

const editable = (make) => (C) => C.MusicEditable({ content: make(C) });
const edit = step.event("click", '[title="Edit it"]');
const type = (label, value) => step.event("input", `[aria-label="${label}"]`, { value });
const click = (selector) => step.event("click", selector);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default stories({
	title: "Music",
	components: { ...musicComponents, MusicEditable: Editable },
	stories: {
		Piano: {
			make: editable((C) => piano(C)),
			sequences: {
				"mark keys, then widen it": [
					click(".piano-keys > g:nth-of-type(1)"),
					step.check("C3 marked", (s) => same(s.content.marked, [48])),
					click(".piano-keys > g:nth-of-type(16)"),
					step.check("and C♯3, the first black key", (s) => same(s.content.labels, ["C", "C♯"])),
					click(".piano-keys > g:nth-of-type(1)"),
					step.check("C3 unmarked", (s) => same(s.content.marked, [49])),
					edit,
					type("Octaves", "3"),
					step.check("three octaves, 22 white keys", (s) => s.content.whites.length === 22),
					type("Octaves", "9"),
					step.check("no more than seven", (s) => s.content.octaves === 3),
					type("Starts at octave", "1"),
					step.check("from C1 to C4", (s) => s.content.rangeText === "C1 to C4"),
				],
			},
		},
		"Circle of fifths": {
			make: editable((C) => circleOfFifths(C)),
			sequences: {
				"pick a key, then its relative minor": [
					step.check("E♭ major, three flats", (s) =>
						s.content.signature.startsWith("3 flats: B♭ E♭ A♭"),
					),
					click(".fifths > g:nth-of-type(7)"),
					step.check(
						"F♯ major, six sharps",
						(s) => s.content.keyName === "F♯ major" && s.content.signature.startsWith("6 sharps"),
					),
					step.check("with E♯ in its scale", (s) => s.content.scale === "F♯ G♯ A♯ B C♯ D♯ E♯"),
					click(".fifths > g:nth-of-type(19)"),
					step.check(
						"D♯ minor, the same signature",
						(s) => s.content.keyName === "D♯ minor" && s.content.signature.startsWith("6 sharps"),
					),
				],
			},
		},
		"Interval picker": {
			make: editable((C) => intervalPicker(C)),
			sequences: {
				"from a minor seventh to a dominant one, on another root": [
					step.check("E♭m7", (s) => s.content.chordText.endsWith("E♭m7.")),
					click('[title="major third (4 semitones)"]'),
					click('[title="minor third (3 semitones)"]'),
					step.check("E♭7", (s) => s.content.chordText.endsWith("E♭7.")),
					step.check("spelled with G, not F𝄪", (s) =>
						same(
							s.content.notes.map((n) => n.name),
							["E♭", "G", "B♭", "D♭"],
						),
					),
					click('[aria-label="Root"] > button:nth-of-type(1)'),
					step.check("C7 on the piano", (s) => same(s.content.piano.labels, ["C", "E", "G", "B♭"])),
					step.check("C is the root, in amber", (s) => s.content.piano.colors[0] === COLORS.root),
					click('[title="Octave up"]'),
					click('[title="Octave up"]'),
					step.check("off the keyboard", (s) => s.content.outside.startsWith("E6 G6 B♭6 are")),
				],
			},
		},
		"Chord explorer": {
			make: editable((C) => chordExplorer(C)),
			sequences: {
				"another chord, its inversions and a wider piano": [
					step.check("E♭maj7 marked", (s) => same(s.content.piano.labels, ["E♭", "G", "B♭", "D"])),
					step.event("change", '[aria-label="Chord"]', { value: "dim" }),
					step.check("E♭°: E♭ G♭ B𝄫", (s) =>
						same(
							s.content.notes.map((n) => n.name),
							["E♭", "G♭", "B𝄫"],
						),
					),
					click('[aria-label="Inversion"] > button:nth-of-type(2)'),
					step.check(
						"first inversion, G♭ lowest",
						(s) => s.content.symbol === "E♭°/G♭" && s.content.piano.marked[0] === 66,
					),
					step.event("change", '[aria-label="Chord"]', { value: "dom7" }),
					click('[aria-label="Inversion"] > button:nth-of-type(4)'),
					step.check("third inversion, D♭ lowest", (s) => s.content.symbol === "E♭7/D♭"),
					step.event("change", '[aria-label="Chord"]', { value: "major" }),
					step.check("a triad has no third inversion", (s) => s.content.inversion === 2),
					edit,
					type("Octaves", "1"),
					step.check("the piano's edit view, inside", (s) => s.content.piano.octaves === 1),
				],
			},
		},
		"Guitar neck": {
			make: editable((C) => guitarNeck(C)),
			sequences: {
				"paint notes in colors, then move along the neck": [
					// The positions go string by string from the high e, a column per fret.
					click('[data-position="0:0"]'),
					step.check("E marked, in blue", (s) =>
						same([s.content.marked, s.content.colors], [[4], ["#38bdf8"]]),
					),
					click('[aria-label="Paint Pink"]'),
					click('[data-position="0:3"]'),
					step.check(
						"G, in pink",
						(s) => s.content.labels[1] === "G" && s.content.colors[1] === "#f9a8d4",
					),
					step.check(
						"everywhere it is: on every string",
						(s) => s.content.positions.filter((p) => p.label === "G").length >= 6,
					),
					click('[data-position="0:0"]'),
					step.check("E repainted pink", (s) => s.content.colors[0] === "#f9a8d4"),
					click('[data-position="0:0"]'),
					step.check("then unmarked", (s) => same(s.content.marked, [7])),
					edit,
					type("Start fret", "5"),
					type("Frets shown", "5"),
					step.check("frets 5 to 9", (s) => s.content.rangeText === "Frets 5 to 9"),
					step.check("a column per fret, on six strings", (s) => s.content.positions.length === 30),
					type("Frets shown", "30"),
					step.check("no more than 24", (s) => s.content.frets === 5),
				],
			},
		},
		"Note or chord": {
			make: editable((C) => noteChordSelector(C)),
			sequences: {
				"a single note, then a chord on another root": [
					step.check("E♭maj7", (s) => s.content.symbol === "E♭maj7"),
					step.event("change", '[aria-label="Note or chord"]', { value: "note" }),
					step.check("E♭ alone", (s) => s.content.names === "E♭"),
					click('[aria-label="Root"] > button:nth-of-type(10)'),
					step.event("change", '[aria-label="Note or chord"]', { value: "minor" }),
					step.check("A minor", (s) => s.content.symbol === "Am" && s.content.names === "A C E"),
				],
			},
		},
		"Note and offset": {
			make: editable((C) => offsetSelector(C)),
			sequences: {
				"move it, then move it back down": [
					step.check("a fifth up: B♭maj7", (s) => s.content.movedSymbol === "B♭maj7"),
					type("Interval offset", "-3"),
					step.check(
						"a minor third down: Cmaj7",
						(s) =>
							s.content.movedSymbol === "Cmaj7" &&
							s.content.offsetText.includes("minor third down"),
					),
					step.check("an octave lower than E♭", (s) => s.content.notes(4).moved[0].midi === 60),
					type("Interval offset", "-12"),
					step.check(
						"an octave down: E♭maj7 again",
						(s) =>
							s.content.movedSymbol === "E♭maj7" && s.content.offsetText.endsWith("octave down"),
					),
				],
			},
		},
		"Offset explorer": {
			make: editable((C) => offsetExplorer(C)),
			sequences: {
				"the picks and the offset, on the piano, then the guitar": [
					step.check(
						"E♭maj7 and B♭maj7, sharing B♭ and D",
						(s) =>
							same(s.content.piano.labels, ["E♭", "G", "B♭", "D", "F", "A"]) &&
							same(s.content.piano.colors.slice(2, 4), [COLORS.both, COLORS.both]),
					),
					click('.music-offset [aria-label="Root"] > button:nth-of-type(1)'),
					step.check("from C: Cmaj7 and Gmaj7 on the piano", (s) =>
						same(s.content.piano.labels, ["C", "E", "G", "B", "D", "F♯"]),
					),
					step.event("change", '[aria-label="Note or chord"]', { value: "note" }),
					type("Interval offset", "4"),
					step.check("C and the E a major third up", (s) =>
						same(
							[s.content.piano.marked, s.content.piano.colors],
							[
								[60, 64],
								[COLORS.root, COLORS.offsetRoot],
							],
						),
					),
					click('[aria-label="Instrument"] > button:nth-of-type(2)'),
					step.check("the guitar", (s) => s.content.instrument === "guitar"),
					step.check("marks C and E, by pitch class", (s) => same(s.content.guitar.marked, [0, 4])),
					type("Interval offset", "0"),
					step.check("no offset: C in both", (s) =>
						same([s.content.guitar.marked, s.content.guitar.colors], [[0], [COLORS.both]]),
					),
					edit,
					type("Frets shown", "5"),
					step.check("the neck's edit view, inside", (s) => s.content.guitar.frets === 5),
				],
			},
		},
	},
});
