// What the music cards share: their colors, the palette an instrument paints its marks with,
// the root picker, the octave stepper and marking notes on an instrument.
import { agentTool, apply, each, field, send, sourceKey, t, tag } from "../../src/tutuca.js";
import { SMALL_BUTTON } from "../common/card.js";
import { isNoteName, octaveOf, parseNoteName, ROOTS } from "./theory.js";

const { div, span } = tag;

export const NOTE = "text-xs opacity-80";
export const between = (lo, hi) => (n) => Number.isInteger(n) && n >= lo && n <= hi;

// The colors marks take: a root, the other notes, the notes an offset moves to, its root, and
// notes in both.
export const COLORS = {
	root: "#f59e0b",
	note: "#38bdf8",
	offsetRoot: "#db2777",
	offset: "#f9a8d4",
	both: "#a78bfa",
	green: "#4ade80",
};
// The ones an instrument's palette offers to paint with.
export const PALETTE = [
	["Amber", COLORS.root],
	["Sky", COLORS.note],
	["Pink", COLORS.offset],
	["Green", COLORS.green],
	["Violet", COLORS.both],
];

// An instrument's palette: paint is the color a click marks with.
export const paintFields = () => ({ paint: t.string().default(COLORS.note) });
export const paintQueries = {
	swatches: {
		get() {
			return PALETTE.map(([name, hex]) => ({
				name: `Paint ${name}`,
				style: `background:${hex}`,
				cls: `size-5 cursor-pointer rounded-full border-2 ${hex === this.paint ? "border-base-content" : "border-transparent"}`,
				pressed: hex === this.paint ? "true" : "false",
			}));
		},
	},
};
export const paintMessages = {
	setPaint: {
		args: [
			t
				.number()
				.int()
				.min(0)
				.max(PALETTE.length - 1),
		],
		run(next, [at]) {
			next.paint = PALETTE[at][1];
		},
	},
};
export const palette = () =>
	div(
		{ class: "flex items-center gap-1", role: "group", "aria-label": "Paint" },
		span({ class: NOTE }, "Paint"),
		each(
			field("swatches"),
			tag.button({
				type: "button",
				class: field("cls"),
				style: field("style"),
				title: field("name"),
				"aria-label": field("name"),
				"aria-pressed": field("pressed"),
				"on:click": send("setPaint", sourceKey()),
			}),
		),
	);
// What clicking a mark does: a mark of another color takes the paint, one of the paint goes;
// on an unmarked one, adds it, labeled label. at is the mark's index in marked, or -1.
export const toggleMark = (self, next, value, at, label) => {
	if (at < 0) {
		next.marked.push(value);
		next.labels.push(label);
		next.colors.push(self.paint);
	} else if (self.colors[at] === self.paint) {
		next.marked.splice(at, 1);
		next.labels.splice(at, 1);
		next.colors.splice(at, 1);
	} else next.colors[at] = self.paint;
};
// The fields an instrument's marks are: what's marked, each one's label and color.
export const markFields = (item) => ({
	marked: t.array(item),
	labels: t.array(t.string()),
	colors: t.array(t.string()),
});
// The pure handler that marks values, each with its label and color.
export const markMessage = (item) => ({
	mark: {
		pure: true,
		args: [t.array(item), t.array(t.string()), t.array(t.string())],
		run(next, [marked, labels, colors]) {
			next.marked = marked;
			next.labels = labels;
			next.colors = colors;
		},
	},
});

// Marks notes ({ midi, name, interval }) on a piano, the root in amber and the others in blue,
// or in the colors given.
export const markOn = (piano, notes, colors = rootColors(notes)) =>
	apply(
		piano,
		"mark",
		notes.map((n) => n.midi),
		notes.map((n) => n.name),
		colors,
	);
// Marks notes on a guitar's neck by pitch class, wherever they're played: the root in amber
// and the others in blue, each pitch class once.
export const markNeckOn = (neck, notes) => {
	const seen = new Set();
	const once = notes.filter((n) => {
		const pc = ((n.midi % 12) + 12) % 12;
		return !seen.has(pc) && seen.add(pc);
	});
	return apply(
		neck,
		"mark",
		once.map((n) => ((n.midi % 12) + 12) % 12),
		once.map((n) => n.name),
		rootColors(once),
	);
};
export const rootColors = (notes, root = COLORS.root, other = COLORS.note) =>
	notes.map((n) => (n.interval === "P1" ? root : other));
// The notes outside piano's keys, said, or "".
export const outsideText = (piano, notes) => {
	const { lo, hi } = piano.range;
	const out = notes.filter((n) => n.midi < lo || n.midi > hi);
	return out.length === 0
		? ""
		: `${out.map((n) => `${n.name}${octaveOf(n.midi)}`).join(" ")} ${out.length === 1 ? "is" : "are"} off the keyboard: edit it to widen it or move it.`;
};

// The twelve roots as buttons as wide as the card, the picked one (the root field, an index in ROOTS) highlighted.
export const rootQueries = {
	roots: {
		get() {
			return ROOTS.map(({ name }, i) => {
				// Like a piano's keys: the ones with an accidental dark, the others light.
				const look =
					i === this.root
						? "btn-primary"
						: name.length > 1
							? "btn-soft btn-neutral"
							: "bg-base-100";
				return {
					name,
					cls: `btn btn-xs join-item flex-1 px-0 ${look}`,
					pressed: i === this.root ? "true" : "false",
				};
			});
		},
	},
	rootName: {
		get() {
			return ROOTS[this.root].name;
		},
	},
};
export const rootPicker = () =>
	div(
		{ class: "join flex w-full", role: "group", "aria-label": "Root" },
		each(
			field("roots"),
			tag.button(
				{
					type: "button",
					class: field("cls"),
					"aria-pressed": field("pressed"),
					title: "Root",
					"on:click": send("setRoot", sourceKey()),
				},
				field("name"),
			),
		),
	);
export const octaveStepper = () =>
	div(
		{ class: "ml-auto flex items-center gap-1", role: "group", "aria-label": "Octave" },
		span({ class: NOTE }, "Octave"),
		tag.button(
			{
				type: "button",
				class: SMALL_BUTTON,
				title: "Octave down",
				"on:click": send("shiftOctave", -1),
			},
			"−",
		),
		span({ class: "font-mono tabular-nums" }, field("octave")),
		tag.button(
			{
				type: "button",
				class: SMALL_BUTTON,
				title: "Octave up",
				"on:click": send("shiftOctave", 1),
			},
			"+",
		),
	);

// A row of notes, each its name and interval on one line, and a warning after them.
export const noteChips = (warning) =>
	div(
		{ class: "music-notes flex flex-wrap items-center gap-1" },
		each(
			field("notes"),
			span(
				{
					class: "inline-flex items-baseline gap-1 rounded border border-base-300 px-1.5 text-sm",
					title: field("about"),
				},
				span({ class: "font-bold" }, field("name")),
				span({ class: "font-mono text-xs opacity-60" }, field("interval")),
			),
		),
		span({ class: "text-xs text-warning" }, field(warning)),
	);

// The palette by name, for an agent: amber, sky, pink, green, violet.
export const PAINT_NAMES = Object.fromEntries(
	PALETTE.map(([name, color]) => [name.toLowerCase(), color]),
);
const paintOf = (name) => PAINT_NAMES[name] ?? COLORS.note;
// What an agent marks an instrument with, by note names: markedOf(parsed) is what's marked
// (a MIDI number on a piano, a pitch class on a guitar's neck).
export const agentMarkMessages = (markedOf) => {
	const notesType = t.array(t.string().where(isNoteName, "a note name like C, F♯, Bb or E♭4"));
	const colorType = t.enum(...Object.keys(PAINT_NAMES));
	const marksOf = (notes, color) =>
		notes.map((text) => {
			const note = parseNoteName(text);
			return { value: markedOf(note), label: note.name, color: paintOf(color) };
		});
	const setMarks = (next, marks) => {
		next.marked = marks.map((m) => m.value);
		next.labels = marks.map((m) => m.label);
		next.colors = marks.map((m) => m.color);
	};
	const current = (self) =>
		self.marked.map((value, i) => ({ value, label: self.labels[i], color: self.colors[i] }));
	return {
		set_marks: {
			pure: true,
			args: [notesType, colorType],
			run(next, [notes, color]) {
				setMarks(next, marksOf(notes, color));
			},
		},
		add_marks: {
			pure: true,
			args: [notesType, colorType],
			run(next, [notes, color]) {
				const added = marksOf(notes, color);
				const kept = current(this).filter((m) => !added.some((a) => a.value === m.value));
				setMarks(next, [...kept, ...added]);
			},
		},
		clear_marks: {
			pure: true,
			args: [],
			run(next) {
				setMarks(next, []);
			},
		},
	};
};
export const agentMarkTools = (what) => [
	agentTool(
		"set_marks",
		"message",
		["notes", "color"],
		`Mark these notes ${what}, in one color, unmarking the rest.`,
	),
	agentTool(
		"add_marks",
		"message",
		["notes", "color"],
		`Mark these notes ${what} too, in one color.`,
	),
	agentTool("clear_marks", "message", [], "Unmark every note."),
];
