// tutuca/pdf: a component's renders.ps as a PDF, made with PDFKit; Ghostscript, when it's
// installed, reads its text back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { printPdf, renderPdf } from "../../src/pdf/index.js";
import { ps, psTarget } from "../../src/ps/index.js";
import { component, each, enableTargets, field, lookupBind, t } from "../../src/tutuca.js";

enableTargets(psTarget);
const { Circle, Group, Page, Path, MoveTo, Arc, Rect, Text } = ps;

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
			Circle({ cx: 150, cy: 40, r: 10, stroke: "#c00", dash: [0, 3], lineCap: "round" }),
			Path(
				{ stroke: "#000" },
				MoveTo({ x: 0, y: 0 }),
				Arc({ cx: 20, cy: 0, r: 5, from: 180, to: 0 }),
			),
		),
	},
});
const text = (bytes) => new TextDecoder("latin1").decode(bytes);
const gs = (bytes, ...args) =>
	spawnSync("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", ...args, "-"], { input: bytes });
const hasGs = gs(new Uint8Array(), "-sDEVICE=nullpage").status === 0;

test("a renders.ps prints as a PDF, a page of the size it says", async () => {
	const bytes = await renderPdf(Bars.make({ title: "Sales", values: [3, 5] }));
	assert.ok(bytes instanceof Uint8Array);
	const pdf = text(bytes);
	assert.match(pdf, /^%PDF-1\.\d/);
	assert.match(pdf, /\/MediaBox \[0 0 200 100\]/);
	assert.match(pdf, /%%EOF\s*$/);
});

test("a Document's pages are its pages, its title the PDF's", async () => {
	const pdf = text(
		await printPdf({
			type: "document",
			title: "Two",
			children: [
				{ type: "page", children: [] },
				{ type: "page", width: 300, height: 50, children: [] },
			],
		}),
	);
	assert.match(pdf, /\/Count 2/);
	assert.match(pdf, /\/MediaBox \[0 0 595 842\]/);
	assert.match(pdf, /\/MediaBox \[0 0 300 50\]/);
	assert.match(pdf, /\/Title \d+ 0 R/);
	assert.match(pdf, /\/Creator \d+ 0 R/);
});

test("a font that isn't standard needs its bytes", async () => {
	await assert.rejects(
		printPdf({ type: "text", x: 0, y: 0, font: "Inter", value: "hi" }),
		/^Error: a PDF has no font Inter: give its bytes in fonts, or use one of Courier, /,
	);
	// No text, no font needed.
	assert.ok(await printPdf({ type: "text", x: 0, y: 0, font: "Inter", value: "" }));
});

const DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
test("a font given by name is embedded", {
	skip: !existsSync(DEJAVU) && "no DejaVu Sans",
}, async () => {
	const tree = { type: "text", x: 10, y: 10, font: "DejaVu", value: "Ωμέγα" };
	const bytes = await printPdf(tree, { fonts: { DejaVu: readFileSync(DEJAVU) } });
	assert.match(text(bytes), /\/FontFile2/);
	if (hasGs) {
		const run = gs(bytes, "-sDEVICE=txtwrite", "-sOutputFile=-");
		assert.equal(run.stdout.toString("utf8").trim(), "Ωμέγα");
	}
});

test("Ghostscript reads it, text upright where it's put", {
	skip: !hasGs && "gs isn't installed",
}, async () => {
	const bytes = await renderPdf(Bars.make({ title: "Año “2026” – €5", values: [3, 5, 2] }));
	const run = gs(bytes, "-sDEVICE=txtwrite", "-sOutputFile=-");
	assert.equal(run.status, 0, run.stderr.toString());
	assert.equal(run.stdout.toString("utf8").trim(), "Año “2026” – €5");
	// Upright where it's put: a line at y 80 of a page 100 high has its ink from its baseline up.
	const line = await printPdf({
		type: "page",
		width: 100,
		height: 100,
		children: [{ type: "text", x: 10, y: 80, value: "HI" }],
	});
	const [, ...box] = /%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/.exec(
		gs(line, "-sDEVICE=bbox").stderr.toString(),
	);
	const [x0, y0, , y1] = box.map(Number);
	assert.ok(x0 >= 10 && x0 <= 11 && y0 >= 79 && y0 <= 80 && y1 > 85 && y1 < 92, box.join(" "));
});
