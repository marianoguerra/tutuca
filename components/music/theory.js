// Music theory on numbers: a pitch class is 0 (C) to 11 (B), a note a MIDI number (60 is middle
// C, C4), an interval a name (P5, m3) with its semitones and how many letters it spans, so notes
// are spelled as music spells them: E♭ minor is E♭ G♭ B♭, not D♯ F♯ A♯.

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL = [0, 2, 4, 5, 7, 9, 11]; // Each letter's pitch class.
const ACCIDENTALS = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
export const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

// The twelve roots to pick from, each spelled the way it's most often written.
export const ROOTS = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].map(
	(name, pc) => ({ pc, name }),
);

// A spelled note: a letter index (0 = C) and an accidental (-1 = ♭, 1 = ♯).
const parse = (name) => ({
	letter: LETTERS.indexOf(name[0]),
	accidental: name.slice(1) === "♭" ? -1 : name.slice(1) === "♯" ? 1 : 0,
});
const pcOf = ({ letter, accidental }) => (((NATURAL[letter] + accidental) % 12) + 12) % 12;
const nameOf = ({ letter, accidental }) =>
	`${LETTERS[letter]}${ACCIDENTALS[accidental] ?? `(${accidental})`}`;
export const pcOfName = (name) => pcOf(parse(name));
// A note name as people type it, C, F♯, Bb or E♭4 (b and # for ♭ and ♯, any case for the
// letter), as { name, pc, octave }, octave null without one; null when it isn't one.
const NOTE_NAME = /^([A-Ga-g])(♯|♭|#|b)?(-?\d)?$/;
export const parseNoteName = (text) => {
	const m = NOTE_NAME.exec(String(text).trim());
	if (m === null) return null;
	const accidental = m[2] === "#" || m[2] === "♯" ? "♯" : m[2] === "b" || m[2] === "♭" ? "♭" : "";
	const name = `${m[1].toUpperCase()}${accidental}`;
	return { name, pc: pcOfName(name), octave: m[3] === undefined ? null : Number(m[3]) };
};
export const isNoteName = (text) => parseNoteName(text) !== null;

// Intervals by name: semitones, and steps (letters) above the root.
export const INTERVALS = {
	P1: { semis: 0, steps: 0, name: "unison" },
	m2: { semis: 1, steps: 1, name: "minor second" },
	M2: { semis: 2, steps: 1, name: "major second" },
	m3: { semis: 3, steps: 2, name: "minor third" },
	M3: { semis: 4, steps: 2, name: "major third" },
	P4: { semis: 5, steps: 3, name: "perfect fourth" },
	A4: { semis: 6, steps: 3, name: "augmented fourth (tritone)" },
	d5: { semis: 6, steps: 4, name: "diminished fifth (tritone)" },
	P5: { semis: 7, steps: 4, name: "perfect fifth" },
	A5: { semis: 8, steps: 4, name: "augmented fifth" },
	m6: { semis: 8, steps: 5, name: "minor sixth" },
	M6: { semis: 9, steps: 5, name: "major sixth" },
	d7: { semis: 9, steps: 6, name: "diminished seventh" },
	m7: { semis: 10, steps: 6, name: "minor seventh" },
	M7: { semis: 11, steps: 6, name: "major seventh" },
	P8: { semis: 12, steps: 7, name: "octave" },
	m9: { semis: 13, steps: 8, name: "minor ninth" },
	M9: { semis: 14, steps: 8, name: "major ninth" },
};
// The ones an interval picker offers, one per semitone up to the octave.
export const PICKABLE = ["m2", "M2", "m3", "M3", "P4", "A4", "P5", "m6", "M6", "m7", "M7", "P8"];
const bySemis = (a, b) => INTERVALS[a].semis - INTERVALS[b].semis;
export const sortIntervals = (names) => [...names].sort(bySemis);

// The note interval above the note named root, spelled.
export const spell = (root, interval) => {
	const r = parse(root);
	const { semis, steps } = INTERVALS[interval];
	const letter = (r.letter + steps) % 7;
	const want = (pcOf(r) + semis) % 12;
	let accidental = (want - NATURAL[letter] + 12) % 12;
	if (accidental > 6) accidental -= 12;
	return nameOf({ letter, accidental });
};

// The MIDI number of the root (a pitch class) in octave (4 has middle C), and its name, C4.
export const midiOf = (pc, octave) => 12 * (octave + 1) + pc;
export const octaveOf = (midi) => Math.floor(midi / 12) - 1;
export const midiName = (midi) => `${SHARP_NAMES[midi % 12]}${octaveOf(midi)}`;
export const isBlack = (midi) => [1, 3, 6, 8, 10].includes(midi % 12);

// Chords by kind: their name, symbol after the root and intervals.
export const CHORDS = {
	major: { name: "major", symbol: "", intervals: ["P1", "M3", "P5"] },
	minor: { name: "minor", symbol: "m", intervals: ["P1", "m3", "P5"] },
	dim: { name: "diminished", symbol: "°", intervals: ["P1", "m3", "d5"] },
	aug: { name: "augmented", symbol: "+", intervals: ["P1", "M3", "A5"] },
	sus2: { name: "suspended second", symbol: "sus2", intervals: ["P1", "M2", "P5"] },
	sus4: { name: "suspended fourth", symbol: "sus4", intervals: ["P1", "P4", "P5"] },
	maj7: { name: "major seventh", symbol: "maj7", intervals: ["P1", "M3", "P5", "M7"] },
	dom7: { name: "dominant seventh", symbol: "7", intervals: ["P1", "M3", "P5", "m7"] },
	min7: { name: "minor seventh", symbol: "m7", intervals: ["P1", "m3", "P5", "m7"] },
	halfDim7: { name: "half-diminished seventh", symbol: "ø7", intervals: ["P1", "m3", "d5", "m7"] },
	dim7: { name: "diminished seventh", symbol: "°7", intervals: ["P1", "m3", "d5", "d7"] },
	add9: { name: "added ninth", symbol: "add9", intervals: ["P1", "M3", "P5", "M9"] },
};

// The notes of a chord: root (a name), kind, octave and inversion (how many of its lowest notes
// go up an octave), each { midi, name, interval }, from the lowest.
export const chordNotes = (root, kind, octave, inversion = 0) => {
	const base = midiOf(pcOfName(root), octave);
	const notes = CHORDS[kind].intervals.map((interval) => ({
		midi: base + INTERVALS[interval].semis,
		name: spell(root, interval),
		interval,
	}));
	for (let i = 0; i < inversion % notes.length; i++) notes[i].midi += 12;
	return notes.sort((a, b) => a.midi - b.midi);
};

// The chord kind whose intervals sound as the semitones do (whatever their spelling), or null.
export const chordOfIntervals = (intervals) => {
	const key = (list) =>
		[...new Set(list.map((i) => INTERVALS[i].semis))].sort((a, b) => a - b).join(",");
	const want = key(["P1", ...intervals]);
	return Object.keys(CHORDS).find((kind) => key(CHORDS[kind].intervals) === want) ?? null;
};

// Scales by kind: their name and intervals above the root, each on its own letter where it
// has seven notes, so they're spelled as music spells them.
export const SCALES = {
	major: { name: "major (Ionian)", intervals: ["P1", "M2", "M3", "P4", "P5", "M6", "M7"] },
	minor: { name: "natural minor (Aeolian)", intervals: ["P1", "M2", "m3", "P4", "P5", "m6", "m7"] },
	harmonicMinor: { name: "harmonic minor", intervals: ["P1", "M2", "m3", "P4", "P5", "m6", "M7"] },
	melodicMinor: { name: "melodic minor", intervals: ["P1", "M2", "m3", "P4", "P5", "M6", "M7"] },
	dorian: { name: "Dorian", intervals: ["P1", "M2", "m3", "P4", "P5", "M6", "m7"] },
	phrygian: { name: "Phrygian", intervals: ["P1", "m2", "m3", "P4", "P5", "m6", "m7"] },
	lydian: { name: "Lydian", intervals: ["P1", "M2", "M3", "A4", "P5", "M6", "M7"] },
	mixolydian: { name: "Mixolydian", intervals: ["P1", "M2", "M3", "P4", "P5", "M6", "m7"] },
	locrian: { name: "Locrian", intervals: ["P1", "m2", "m3", "P4", "d5", "m6", "m7"] },
	majorPentatonic: { name: "major pentatonic", intervals: ["P1", "M2", "M3", "P5", "M6"] },
	minorPentatonic: { name: "minor pentatonic", intervals: ["P1", "m3", "P4", "P5", "m7"] },
	blues: { name: "blues", intervals: ["P1", "m3", "P4", "d5", "P5", "m7"] },
	wholeTone: { name: "whole tone", intervals: ["P1", "M2", "M3", "A4", "A5", "m7"] },
};
export const scaleOf = (root, kind) => SCALES[kind].intervals.map((i) => spell(root, i));
// The notes of a scale: root (a name), kind and octave, each { midi, name, interval }, from the
// root up to the root an octave above.
export const scaleNotes = (root, kind, octave) => {
	const base = midiOf(pcOfName(root), octave);
	return [...SCALES[kind].intervals, "P8"].map((interval) => ({
		midi: base + INTERVALS[interval].semis,
		name: spell(root, interval),
		interval,
	}));
};

// The circle of fifths, clockwise from the top: each major key and its relative minor.
export const CIRCLE = [
	["C", "A"],
	["G", "E"],
	["D", "B"],
	["A", "F♯"],
	["E", "C♯"],
	["B", "G♯"],
	["F♯", "D♯"],
	["D♭", "B♭"],
	["A♭", "F"],
	["E♭", "C"],
	["B♭", "G"],
	["F", "D"],
].map(([major, minor]) => ({ major, minor }));

// A key's signature: its sharps or flats, in the order they're written.
const SHARP_ORDER = ["F♯", "C♯", "G♯", "D♯", "A♯", "E♯", "B♯"];
const FLAT_ORDER = ["B♭", "E♭", "A♭", "D♭", "G♭", "C♭", "F♭"];
export const signatureOf = (major) => {
	const notes = scaleOf(major, "major");
	const sharps = SHARP_ORDER.filter((n) => notes.includes(n));
	const flats = FLAT_ORDER.filter((n) => notes.includes(n));
	return sharps.length > 0 ? sharps : flats;
};
export const signatureText = (major) => {
	const sig = signatureOf(major);
	if (sig.length === 0) return "No sharps or flats";
	const kind = sig[0].endsWith("♯") ? "sharp" : "flat";
	return `${sig.length} ${kind}${sig.length === 1 ? "" : "s"}: ${sig.join(" ")}`;
};

// What a selector picks: a single note, or a chord, on a root.
export const SELECTION_KINDS = ["note", ...Object.keys(CHORDS)];
// The notes of a selection on the root named root, in octave, as chordNotes gives them.
export const selectionNotes = (root, kind, octave) =>
	kind === "note"
		? [{ midi: midiOf(pcOfName(root), octave), name: root, interval: "P1" }]
		: chordNotes(root, kind, octave);
export const selectionSymbol = (root, kind) =>
	kind === "note" ? root : `${root}${CHORDS[kind].symbol}`;

// An offset of semitones, said: how far and which interval, up or down.
const OFFSET_NAMES = [
	"unison",
	"minor second",
	"major second",
	"minor third",
	"major third",
	"perfect fourth",
	"tritone",
	"perfect fifth",
	"minor sixth",
	"major sixth",
	"minor seventh",
	"major seventh",
	"octave",
];
export const offsetText = (semis) => {
	if (semis === 0) return "No offset";
	const n = Math.abs(semis);
	return `${semis > 0 ? "+" : "−"}${n} semitone${n === 1 ? "" : "s"}: a ${OFFSET_NAMES[n]} ${semis > 0 ? "up" : "down"}`;
};
// The same selection moved semis up (or down): its root is spelled as ROOTS spells it.
export const offsetSelection = (rootPc, kind, octave, semis, roots) => {
	const midi = midiOf(rootPc, octave) + semis;
	const root = roots[((midi % 12) + 12) % 12].name;
	return { root, notes: selectionNotes(root, kind, octaveOf(midi)) };
};
