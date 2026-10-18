import { step, stories } from "../../src/storybook/index.js";
import { saveFile } from "../common/files.js";
import { drawingComponents } from "./index.js";

// A house in the sun, as shapes.
const house = (C) => [
	C.Rect({
		id: "s1",
		x0: 200,
		y0: 200,
		x1: 360,
		y1: 330,
		stroke: "#880015",
		fill: "#ffaec9",
		width: 4,
	}),
	C.Polyline({
		id: "s2",
		points: [190, 205, 280, 130, 370, 205],
		stroke: "#880015",
		fill: "#ed1c24",
		width: 4,
	}),
	C.Rect({
		id: "s3",
		x0: 260,
		y0: 260,
		x1: 300,
		y1: 330,
		stroke: "#000000",
		fill: "#b97a57",
		width: 2,
	}),
	C.Ellipse({
		id: "s4",
		x0: 480,
		y0: 40,
		x1: 560,
		y1: 120,
		stroke: "#ff7f27",
		fill: "#fff200",
		width: 4,
	}),
	C.Line({ id: "s5", x0: 0, y0: 330, x1: 640, y1: 330, stroke: "#22b14c", fill: "none", width: 8 }),
];
export const houseDrawing = (C, rest = {}) => C.Drawing({ shapes: house(C), ...rest });
// Drags from (x0, y0) to (x1, y1) through a point between them.
const drag = (x0, y0, x1, y1) => [
	step.send("startAt", [x0, y0]),
	step.send("moveTo", [(x0 + x1) / 2, (y0 + y1) / 2]),
	step.send("moveTo", [x1, y1]),
	step.send("end"),
];
const last = (s) => s.shapes.at(-1);
const byId = (s, id) => s.shapes.find((x) => x.id === id);

const messages = [
	"Drawing.setTool",
	"Drawing.setWidth",
	"Drawing.setFill",
	"Drawing.setStroke",
	"Drawing.startAt",
	"Drawing.moveTo",
	"Drawing.end",
	"Drawing.finish",
	"Drawing.cancel",
	"Drawing.shapeDown",
	"Drawing.raise",
	"Drawing.lower",
	"Drawing.duplicate",
	"Drawing.remove",
	"Drawing.undo",
	"Drawing.redo",
	"Drawing.clear",
];

export default stories({
	title: "Drawing",
	components: drawingComponents,
	askHandlers: {
		saveFile,
	},
	stories: {
		"Shapes/Rectangle": {
			make: (C) =>
				C.Drawing({
					width: 240,
					height: 120,
					shapes: [C.Rect({ id: "s1", x0: 200, y0: 100, x1: 40, y1: 20, fill: "#99d9ea" })],
				}),
		},
		"Shapes/Ellipse": {
			make: (C) =>
				C.Drawing({
					width: 240,
					height: 120,
					shapes: [
						C.Ellipse({
							id: "s1",
							x0: 20,
							y0: 10,
							x1: 220,
							y1: 110,
							stroke: "#a349a4",
							fill: "#c8bfe7",
							width: 4,
						}),
					],
				}),
		},
		"Shapes/Line": {
			make: (C) =>
				C.Drawing({
					width: 240,
					height: 120,
					shapes: [
						C.Line({ id: "s1", x0: 20, y0: 100, x1: 220, y1: 20, stroke: "#3f48cc", width: 8 }),
					],
				}),
		},
		"Shapes/Polyline": {
			make: (C) =>
				C.Drawing({
					width: 240,
					height: 120,
					shapes: [
						C.Polyline({
							id: "s1",
							points: [10, 100, 60, 20, 120, 90, 180, 15, 230, 100],
							width: 4,
						}),
					],
				}),
		},
		"Drawing/Blank": {
			make: (C) => C.Drawing(),
			sequences: {
				"one of each shape": [
					step.send("setTool", ["rect"]),
					step.send("setFill", ["#fff200"]),
					...drag(40, 40, 200, 160),
					step.check(
						"a yellow rectangle",
						(s) => last(s).fill === "#fff200" && last(s).boxWidth === 160,
					),
					step.send("setTool", ["ellipse"]),
					step.send("setStroke", ["#ed1c24"]),
					step.send("setFill", ["none"]),
					...drag(300, 60, 420, 180),
					step.check(
						"a red outlined ellipse",
						(s) => last(s).stroke === "#ed1c24" && last(s).fill === "none" && last(s).rx === 60,
					),
					step.send("setTool", ["line"]),
					step.send("setWidth", ["8"]),
					...drag(450, 300, 600, 380),
					step.check("a thick line", (s) => last(s).width === 8),
					step.send("setTool", ["polyline"]),
					step.send("startAt", [20, 300]),
					step.send("moveTo", [60, 250]),
					step.send("end"),
					step.check(
						"still drawing the polyline",
						(s) => s.current !== null && s.shapes.length === 3,
					),
					step.send("startAt", [60, 250]),
					step.send("moveTo", [120, 320]),
					step.send("startAt", [120, 320]),
					step.send("finish"),
					step.check(
						"a polyline of three points",
						(s) => last(s).points.join() === "20,300,60,250,120,320",
					),
				],
				"a click is not a shape": [
					step.send("setTool", ["rect"]),
					step.send("startAt", [50, 50]),
					step.send("end"),
					step.check("nothing drawn", (s) => s.shapes.length === 0 && s.current === null),
				],
				"keyboard: tools and cancel": [
					step.event("keydown", '[tabindex="0"]', {}),
					step.send("setTool", ["polyline"]),
					step.send("startAt", [10, 10]),
					step.send("cancel"),
					step.check("cancelled", (s) => s.current === null),
				],
			},
			pbt: { include: messages, maxCommands: 20 },
		},
		"Drawing/House": {
			make: (C) => houseDrawing(C),
			sequences: {
				"select, move and restyle": [
					step.send("shapeDown", ["s4", 520, 80]),
					step.check("the sun is selected", (s) => s.selected === "s4"),
					step.send("moveTo", [500, 100]),
					step.send("moveTo", [480, 120]),
					step.send("end"),
					step.check("moved down left", (s) => byId(s, "s4").x0 === 440 && byId(s, "s4").y0 === 80),
					step.send("setFill", ["#ff7f27"]),
					step.check("an orange sun", (s) => byId(s, "s4").fill === "#ff7f27"),
					step.send("undo"),
					step.send("undo"),
					step.check(
						"back where it was, yellow",
						(s) => byId(s, "s4").x0 === 480 && byId(s, "s4").fill === "#fff200",
					),
					step.send("redo"),
					step.check("moved again", (s) => byId(s, "s4").x0 === 440),
				],
				"order, duplicate and delete": [
					step.send("shapeDown", ["s3", 280, 300]),
					step.send("end"),
					step.send("lower"),
					step.check("the door went under the wall", (s) => s.shapes[1].id === "s3"),
					step.send("raise"),
					step.send("duplicate"),
					step.check(
						"a copy, selected, offset",
						(s) => s.selected === s.shapes[3].id && s.shapes[3].x0 === 270,
					),
					step.send("remove"),
					step.check("deleted the copy", (s) => s.shapes.length === 5 && s.selected === ""),
					step.send("shapeDown", ["s2", 280, 140]),
					step.event("keydown", '[tabindex="0"]', {}),
					step.send("remove"),
					step.check("no roof", (s) => !byId(s, "s2")),
					step.send("undo"),
					step.check("roof back", (s) => byId(s, "s2") !== undefined),
				],
				"drawing over a shape starts a new one": [
					step.send("setTool", ["ellipse"]),
					step.send("shapeDown", ["s1", 220, 220]),
					step.send("moveTo", [240, 240]),
					step.send("end"),
					step.check("drawn on top", (s) => last(s).cx === 230),
				],
				"new, then undo it": [
					step.send("clear"),
					step.check("blank", (s) => s.shapes.length === 0),
					step.send("undo"),
					step.check("all back", (s) => s.shapes.length === 5),
				],
				"save as svg": [
					step.check("a standalone svg", (s) =>
						s.toSvg().startsWith('<svg xmlns="http://www.w3.org/2000/svg"'),
					),
					step.check("with every shape", (s) => (s.toSvg().match(/^ {2}</gm) ?? []).length === 5),
					step.send("exportSvg"),
				],
			},
			pbt: { include: messages, maxCommands: 20 },
		},
		"Drawing/Selected": { make: (C) => houseDrawing(C, { selected: "s1", tool: "select" }) },
		"Drawing/Generated": {
			arbitrary: (A) => A.instance("Drawing"),
			pbt: { include: messages, maxCommands: 15 },
		},
		"Drawing/DOM events": { make: (C) => houseDrawing(C), pbt: { events: true, maxCommands: 15 } },
	},
});
