// tutuca/ps: components whose renders.ps draw, checked when the tags are built and when they
// render, and printed as PostScript (which Ghostscript runs, when it's installed).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
	num,
	PsError,
	printPs,
	ps,
	psString,
	psTarget,
	renderPs,
	renderPsTree,
	setColor,
} from "../../src/ps/index.js";
import {
	$if,
	component,
	each,
	enableTargets,
	field,
	lookupBind,
	renderEach,
	Scope,
	t,
} from "../../src/tutuca.js";

enableTargets(psTarget);

const { Arc, Circle, ClosePath, CurveTo, Document, Group, Line, LineTo, MoveTo, Page, Path } = ps;
const { Polyline, Rect, Text } = ps;

const scope = (components) => {
	const s = new Scope();
	s.register(components);
	return s.components;
};
const fails = (fn, ...messages) => {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof PsError, error);
		assert.deepEqual(error.issues, messages);
		return true;
	});
};

const Bars = component({
	name: "Bars",
	fields: { title: t.string(), values: t.array(t.number()) },
	loops: { bars: { enrich: ({ value }) => ({ height: value * 10 }) } },
	renders: {
		ps: Page(
			{ width: 200, height: 100 },
			Text({ x: 100, y: 90, align: "center" }, field("title")),
			Group(
				{ x: 10, y: 10, stepX: 30 },
				each(
					field("values"),
					Rect({ x: 0, y: 0, width: 20, height: lookupBind("height") }),
					"bars",
				),
			),
		),
	},
});

test("a renders.ps renders its fields into the drawing it says", () => {
	const tree = renderPsTree(Bars.make({ title: "Sales", values: [3, 5] }));
	assert.deepEqual(tree, {
		type: "page",
		width: 200,
		height: 100,
		children: [
			{ type: "text", x: 100, y: 90, align: "center", value: "Sales" },
			{
				type: "group",
				x: 10,
				y: 10,
				stepX: 30,
				children: [
					{ type: "rect", x: 0, y: 0, width: 20, height: 30 },
					{ type: "rect", x: 0, y: 0, width: 20, height: 50 },
				],
			},
		],
	});
});

test("it prints as a DSC document, a page per Page, children stepped", () => {
	const text = renderPs(Bars.make({ title: "Sales", values: [3, 5] }));
	assert.ok(text.startsWith("%!PS-Adobe-3.0\n%%Creator: tutuca\n%%Pages: 1\n"), text);
	assert.ok(text.endsWith("showpage\n%%Trailer\n%%EOF\n"));
	assert.match(text, /^%%BoundingBox: 0 0 200 100$/m);
	assert.match(text, /^%%DocumentNeededResources: font Helvetica$/m);
	assert.match(text, /^<< \/PageSize \[200 100\] >> setpagedevice$/m);
	assert.match(text, /^100 90 moveto \(Sales\) centershow$/m);
	assert.match(
		text,
		/gsave\n {2}10 10 translate\n {2}newpath 0 0 20 30 rectpath\n {2}0 setgray fill\n {2}30 0 translate\n {2}newpath 0 0 20 50 rectpath\n {2}0 setgray fill\ngrestore/,
	);
});

test("shapes fill or stroke as they say, black by what they are when they say neither", () => {
	const out = (graphic) => printPs({ type: "page", children: [graphic] });
	assert.match(
		out({ type: "rect", x: 0, y: 0, width: 1, height: 1 }),
		/rectpath\n0 setgray fill\n/,
	);
	assert.match(out({ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }), /lineto\n0 setgray stroke\n/);
	assert.match(
		out({
			type: "polyline",
			points: [
				[0, 0],
				[1, 1],
			],
		}),
		/newpath 0 0 moveto 1 1 lineto\n0 setgray stroke\n/,
	);
	assert.match(
		out({
			type: "polyline",
			points: [
				[0, 0],
				[1, 1],
				[1, 0],
			],
			closed: true,
		}),
		/1 0 lineto closepath\n0 setgray fill\n/,
	);
	assert.match(
		out({ type: "circle", cx: 5, cy: 5, r: 2, fill: "#f00", stroke: "#00f", lineWidth: 2 }),
		/gsave\n {2}2 setlinewidth\n {2}newpath 5 5 2 0 360 arc closepath\n {2}gsave 1 0 0 setrgbcolor fill grestore\n {2}0 0 1 setrgbcolor stroke\ngrestore\n/,
	);
	// A fill doesn't stroke, so the stroke's style isn't set.
	assert.match(
		out({ type: "circle", cx: 0, cy: 0, r: 1, fill: "#fff", lineWidth: 3 }),
		/\nnewpath 0 0 1 0 360 arc closepath\n1 setgray fill\n/,
	);
});

test("paths print their segments", () => {
	const Shape = component({
		name: "Shape",
		renders: {
			ps: Path(
				{ stroke: "#000", dash: [2, 1], lineCap: "round", lineJoin: "bevel" },
				MoveTo({ x: 0, y: 0 }),
				LineTo({ x: 10, y: 0 }),
				CurveTo({ x1: 12, y1: 2, x2: 12, y2: 8, x: 10, y: 10 }),
				Arc({ cx: 5, cy: 10, r: 5, from: 0, to: 180, clockwise: true }),
				ClosePath(),
			),
		},
	});
	assert.match(
		renderPs(Shape.make()),
		/gsave\n {2}\[2 1\] 0 setdash\n {2}1 setlinecap\n {2}2 setlinejoin\n {2}newpath 0 0 moveto 10 0 lineto 12 2 12 8 10 10 curveto 5 10 5 0 180 arcn closepath\n {2}0 setgray stroke\ngrestore\n/,
	);
});

test("a Graphic at the root is drawn on an A4 page; a Document's size is its pages'", () => {
	const graphic = printPs({ type: "circle", cx: 1, cy: 1, r: 1 });
	assert.match(graphic, /^%%Pages: 1$/m);
	assert.match(graphic, /^%%PageBoundingBox: 0 0 595 842$/m);
	const doc = printPs({
		type: "document",
		title: "Two (pages)",
		width: 100,
		height: 50,
		children: [
			{ type: "page", children: [] },
			{ type: "page", label: "wide", width: 300, children: [] },
		],
	});
	assert.match(doc, /^%%Title: \(Two \\\(pages\\\)\)$/m);
	assert.match(doc, /^%%BoundingBox: 0 0 300 50$/m);
	assert.match(doc, /^%%Page: 1 1\n%%PageBoundingBox: 0 0 100 50$/m);
	assert.match(doc, /^%%Page: \(wide\) 2\n%%PageBoundingBox: 0 0 300 50$/m);
});

test("text is Latin-1 in reencoded fonts, a line per newline", () => {
	assert.equal(psString("a(b)c\\"), "(a\\(b\\)c\\\\)");
	assert.equal(psString("año €"), "(a\\361o ?)");
	assert.equal(psString("“hi” – bye…"), '("hi" - bye...)');
	assert.equal(psString("a-b", { latin1: true }), "(a\\255b)");
	const text = printPs({
		type: "text",
		x: 10,
		y: 100,
		size: 10,
		font: "Times-Bold",
		fill: "#336699",
		value: "one\ntwo-three",
	});
	assert.match(text, /^\/Times-Bold-Latin1 \/Times-Bold latin1font$/m);
	assert.match(
		text,
		/^\/Times-Bold-Latin1 findfont 10 scalefont setfont\n0\.2 0\.4 0\.6 setrgbcolor\n10 100 moveto \(one\) show\n10 88 moveto \(two\\255three\) show$/m,
	);
	// Symbol's characters are its own: not reencoded, - left as is.
	const symbol = printPs({ type: "text", x: 0, y: 0, font: "Symbol", value: "a-b" });
	assert.doesNotMatch(symbol, /latin1font\n(?!.*%%EndProlog)/s);
	assert.match(symbol, /^\/Symbol findfont 12 scalefont setfont$/m);
	assert.match(symbol, /\(a-b\) show/);
});

test("numbers and colors print as PostScript reads them", () => {
	assert.deepEqual([0.1 + 0.2, -0.0001, 1 / 3, 12, -4.5].map(num), [
		"0.3",
		"0",
		"0.333",
		"12",
		"-4.5",
	]);
	assert.equal(setColor("#fff"), "1 setgray");
	assert.equal(setColor("#ff0000"), "1 0 0 setrgbcolor");
});

test("tags are checked when they're built", () => {
	fails(
		() => ps.Square({ x: 0 }),
		"unknown ps type Square (one of Document, Page, Group, Rect, Circle, Line, Polyline, Path, MoveTo, LineTo, CurveTo, Arc, ClosePath, Text)",
	);
	fails(
		() => Rect({ x: 0, y: 0, width: -1 }),
		"Rect.width is a number, 0 or more, not -1",
		"Rect needs attr height",
	);
	fails(
		() => Circle({ cx: 0, cy: 0, r: 1, fill: "red" }),
		'Circle.fill is a color, #rgb or #rrggbb, not "red"',
	);
	fails(
		() => Line({ x1: 0, y1: 0, x2: 1, y2: 1, fill: "#000" }),
		"Line has no attr fill (its attrs: x1, y1, x2, y2, stroke, lineWidth, dash, lineCap, lineJoin)",
	);
	fails(
		() => Page(Text({ x: 0, y: 0 }, Rect({ x: 0, y: 0, width: 1, height: 1 }))),
		"Text holds text, not Rect",
	);
	fails(() => Group("loose"), 'Group can\'t hold text ("loose")');
	fails(() => Document(Rect({ x: 0, y: 0, width: 1, height: 1 })), "Document takes Page, not Rect");
	fails(() => Path(Rect({ x: 0, y: 0, width: 1, height: 1 })), "Path takes a Segment, not Rect");
	fails(
		() => Polyline({ points: [[0, 0]] }),
		"Polyline.points is an array of two or more [x, y], not [[0,0]]",
	);
	fails(
		() => Text({ x: 0, y: 0, font: "Bad Font" }),
		'Text.font is a font name, as Helvetica or Times-Bold, not "Bad Font"',
	);
	// A computed attr is checked when it renders.
	assert.ok(Rect({ x: 0, y: 0, width: field("w"), height: 1 }));
});

test("the drawing is checked when it renders, each issue at its path", () => {
	const Bad = component({
		name: "Bad",
		fields: { w: t.number(), color: t.string() },
		renders: {
			ps: Page(
				Rect({ x: 0, y: 0, width: field("w"), height: 1, fill: field("color") }),
				Path(LineTo({ x: 1, y: 1 })),
				Path({ fill: "#000" }),
			),
		},
	});
	fails(
		() => renderPsTree(Bad.make({ w: -2, color: "blue" })),
		"Page.children[0]: Rect.width is a number, 0 or more, not -2",
		'Page.children[0]: Rect.fill is a color, #rgb or #rrggbb, not "blue"',
		"Page.children[1]: Path starts with a MoveTo or an Arc, not LineTo",
		"Page.children[2]: Path has no segments",
	);
	const Two = component({
		name: "Two",
		renders: { ps: $if(true, MoveTo({ x: 0, y: 0 }), Page()) },
	});
	fails(
		() => renderPsTree(Two.make()),
		"a ps render renders a Document, a Page or a Graphic, not MoveTo",
	);
});

test("a component draws its children's renders.ps where it puts them", () => {
	const Dot = component({
		name: "Dot",
		fields: { x: t.number(), color: t.string() },
		renders: { ps: Circle({ cx: field("x"), cy: 0, r: 2, fill: field("color") }) },
	});
	const Dots = component({
		name: "Dots",
		fields: { dots: t.array(t.component("Dot")), hidden: t.boolean() },
		renders: {
			ps: Group({ y: 10 }, $if(field("hidden"), Group(), renderEach(field("dots")))),
		},
	});
	const C = scope({ Dot, Dots });
	const tree = renderPsTree(
		C.Dots({ dots: [C.Dot({ x: 1, color: "#f00" }), C.Dot({ x: 5, color: "#0f0" })] }),
	);
	assert.deepEqual(tree, {
		type: "group",
		y: 10,
		children: [
			{ type: "circle", cx: 1, cy: 0, r: 2, fill: "#f00" },
			{ type: "circle", cx: 5, cy: 0, r: 2, fill: "#0f0" },
		],
	});
});

const hasGs = spawnSync("gs", ["--version"]).status === 0;
test("Ghostscript runs what it prints", { skip: !hasGs && "gs isn't installed" }, () => {
	const text = renderPs(Bars.make({ title: "Año – “2026” (draft)", values: [3, 5, 2] }));
	const run = spawnSync(
		"gs",
		["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=txtwrite", "-sOutputFile=-", "-"],
		{ input: text, encoding: "utf8" },
	);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stdout.trim(), 'Año - "2026" (draft)');
});
