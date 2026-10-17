import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
// biome-ignore lint/correctness/noUnresolvedImports: jsdom uses conditional exports that Node resolves.
import { JSDOM } from "jsdom";
import { drawingComponents } from "../components/drawing/index.js";
import { fmt, mathComponents } from "../components/math/index.js";
import { arbitraries, Driver, specProperties } from "../src/test/pbt.js";
import { DispatchPath, Scope } from "../src/tutuca.js";

const { document } = new JSDOM("").window;
const SVG = "http://www.w3.org/2000/svg";
const MATHML = "http://www.w3.org/1998/Math/MathML";

const scopeWith = (components) => {
	const scope = new Scope(() => {});
	scope.register(components);
	return scope;
};

for (const components of [drawingComponents, mathComponents]) {
	for (const [name, spec] of Object.entries(components)) {
		test(`${name} has the generic properties`, () => {
			const A = arbitraries({ fc, scope: scopeWith(components) });
			for (const [propName, prop] of Object.entries(specProperties(spec, A, { document }))) {
				try {
					fc.assert(prop, { numRuns: 25 });
				} catch (error) {
					error.message = `${name}.${propName}: ${error.message}`;
					throw error;
				}
			}
		});
	}
}

test("shapes render as SVG elements inside the canvas", () => {
	const C = scopeWith(drawingComponents).components;
	const shapes = [
		C.Rect({ id: "a", x0: 50, y0: 40, x1: 10, y1: 10 }),
		C.Polyline({ id: "b", points: [0, 0, 10, 20, 30, 5] }),
	];
	const driver = new Driver({ root: C.Drawing({ shapes, selected: "a" }), document });
	const canvas = driver.rootNode.querySelector("svg");
	assert.equal(canvas.namespaceURI, SVG);
	const rect = canvas.querySelector("g rect");
	assert.equal(rect.namespaceURI, SVG);
	assert.deepEqual(
		["x", "y", "width", "height"].map((a) => rect.getAttribute(a)),
		["10", "10", "40", "30"],
	);
	assert.equal(canvas.querySelector("polyline").getAttribute("points"), "0,0 10,20 30,5");
	assert.equal(canvas.querySelector("rect[stroke-dasharray]").getAttribute("width"), "50");
});

test("formulas render as MathML", () => {
	const C = scopeWith(mathComponents).components;
	const driver = new Driver({ root: C.Quadratic({ a: 2, b: -4, c: -6 }), document });
	const math = driver.rootNode.querySelector("math");
	assert.equal(math.namespaceURI, MATHML);
	assert.equal(driver.rootNode.querySelector("mfrac").namespaceURI, MATHML);
	assert.match(driver.rootNode.textContent.replace(/\s+/g, ""), /x1=−1,x2=3/);
	assert.equal(driver.rootNode.querySelector("svg").namespaceURI, SVG);
	assert.deepEqual([1.23456, -2, -0, 1e-9].map(fmt), ["1.235", "−2", "0", "0"]);
});

// Releasing over the dragged shape itself must end the drag: the shape, not the canvas, is
// the event's target when nothing captured the pointer.
test("a drag ends on release over the shape, so later moves don't move it", () => {
	const C = scopeWith(drawingComponents).components;
	const shapes = [C.Rect({ id: "a", x0: 10, y0: 10, x1: 50, y1: 40 })];
	const driver = new Driver({ root: C.Drawing({ shapes, tool: "select" }), document });
	const { MouseEvent } = document.defaultView;
	const pointer = (el, type, x, y) =>
		el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
	const rect = () => driver.rootNode.querySelector("g rect");
	const canvas = driver.rootNode.querySelector("svg");
	pointer(rect(), "pointerdown", 20, 20);
	assert.equal(driver.state.selected, "a");
	pointer(rect(), "pointermove", 25, 30);
	assert.deepEqual([driver.state.shapes[0].x0, driver.state.shapes[0].y0], [15, 20]);
	pointer(rect(), "pointerup", 25, 30);
	assert.equal(driver.state.dragFrom, null);
	pointer(canvas, "pointermove", 200, 200);
	pointer(rect(), "pointermove", 100, 100);
	assert.deepEqual([driver.state.shapes[0].x0, driver.state.shapes[0].y0], [15, 20]);
	assert.equal(driver.state.selected, "a");
	assert.deepEqual(driver.problems, []);
});

// Shapes stay within the coordinate range: a duplicate at the edge goes the other way, and a
// drag past it stops the shape there, keeping its size.
test("duplicating and moving shapes at the edge keeps them in range", () => {
	const C = scopeWith(drawingComponents).components;
	const shapes = [C.Rect({ id: "a", x0: 9990, y0: 0, x1: 10000, y1: 20 })];
	const driver = new Driver({ root: C.Drawing({ shapes, selected: "a", nextId: 1 }), document });
	const send = (name, args = []) => driver.send(new DispatchPath(), name, args);
	send("duplicate");
	const corners = (s) => [s.x0, s.y0, s.x1, s.y1];
	assert.deepEqual(corners(driver.state.shapes[1]), [9980, 10, 9990, 30]);
	assert.equal(driver.state.selected, "s1");
	send("shapeDown", ["s1", 10000, -10000]);
	send("moveTo", [-10000, 10000]); // 20000 each way, more than the room left on either axis
	assert.deepEqual(corners(driver.state.shapes[1]), [-10000, 9980, -9990, 10000]);
	send("moveTo", [-9999.5, 9999.5]);
	assert.deepEqual(corners(driver.state.shapes[1]), [-9999.5, 9979.5, -9989.5, 9999.5]);
	assert.deepEqual(driver.problems, []);
});
