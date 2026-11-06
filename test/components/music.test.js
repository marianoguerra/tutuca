import assert from "node:assert/strict";
import test from "node:test";
import { pianoKeys } from "../../components/music/piano.js";
import {
	chordNotes,
	chordOfIntervals,
	midiName,
	scaleOf,
	signatureText,
	spell,
} from "../../components/music/theory.js";

const names = (notes) => notes.map((n) => n.name);

test("spell: the letter an interval spans, then its accidental", () => {
	assert.equal(spell("C", "M3"), "E");
	assert.equal(spell("E♭", "m3"), "G♭");
	assert.equal(spell("C", "A4"), "F♯");
	assert.equal(spell("C", "d5"), "G♭");
	assert.equal(spell("F♯", "M7"), "E♯");
	assert.equal(spell("D♭", "d7"), "C𝄫");
	assert.equal(spell("B", "P8"), "B");
});

test("chordNotes: spelled, from the lowest, inverted", () => {
	assert.deepEqual(names(chordNotes("C", "major", 4)), ["C", "E", "G"]);
	assert.deepEqual(
		chordNotes("C", "major", 4).map((n) => midiName(n.midi)),
		["C4", "E4", "G4"],
	);
	assert.deepEqual(names(chordNotes("B", "dim7", 3)), ["B", "D", "F", "A♭"]);
	const first = chordNotes("C", "major", 4, 1);
	assert.deepEqual(
		first.map((n) => midiName(n.midi)),
		["E4", "G4", "C5"],
	);
	assert.deepEqual(names(chordNotes("A", "add9", 3)), ["A", "C♯", "E", "B"]);
});

test("chordOfIntervals: by how they sound, whatever their spelling", () => {
	assert.equal(chordOfIntervals(["M3", "P5"]), "major");
	assert.equal(chordOfIntervals(["m3", "A4"]), "dim", "A4 sounds as d5");
	assert.equal(chordOfIntervals(["M3", "m6"]), "aug");
	assert.equal(chordOfIntervals(["M3"]), null);
});

test("scales and signatures", () => {
	assert.equal(scaleOf("A", "minor").join(" "), "A B C D E F G");
	assert.equal(scaleOf("D♭", "major").join(" "), "D♭ E♭ F G♭ A♭ B♭ C");
	assert.equal(signatureText("C"), "No sharps or flats");
	assert.equal(signatureText("G"), "1 sharp: F♯");
	assert.equal(signatureText("D♭"), "5 flats: B♭ E♭ A♭ D♭ G♭");
});

test("pianoKeys: whites and blacks over them, marked ones named", () => {
	const { whites, blacks, width } = pianoKeys({
		startOctave: 4,
		octaves: 1,
		marked: [60, 61],
		labels: ["C", "D♭"],
		colors: ["#f59e0b", ""],
	});
	assert.equal(whites.length, 8, "C4 to C5");
	assert.equal(blacks.length, 5);
	assert.equal(width, 8 * 24);
	assert.equal(blacks[0].x, 24 - 7, "C♯ over the line between C and D");
	assert.deepEqual([whites[0].label, blacks[0].label, whites[7].label], ["C", "D♭", "C5"]);
	assert.notEqual(whites[0].fill, blacks[0].fill, "the root shows apart");
});
