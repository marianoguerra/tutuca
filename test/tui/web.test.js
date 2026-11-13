// A Screen on a page: its cells drawn as styled text, a page's keys sent to it, and the terminal
// preview, <tutuca-terminal>, showing another host's app and running what's done in it there.
import assert from "node:assert/strict";
import test from "node:test";
import { Counter } from "../../site/examples/counter.js";
import { defineTutucaTerminal, TERMINAL_REQUEST } from "../../src/tui/element.js";
import { CellBuffer, drawRow, keyOf, mirrorTui, sgrCss } from "../../src/tui/index.js";
import { tuiTarget } from "../../src/tui/target.js";
import { enableTargets, Host } from "../../src/tutuca.js";
import { dom } from "../helpers.js";

enableTargets(tuiTarget);

test("a cell's SGR style is CSS: the 16 colors as variables, the rest as RGB", () => {
	assert.equal(sgrCss(""), "");
	assert.equal(sgrCss("1;31"), "color: var(--tui-color-1); font-weight: bold");
	assert.equal(
		sgrCss("96;100"),
		"color: var(--tui-color-14); background-color: var(--tui-color-8)",
	);
	assert.equal(
		sgrCss("38;2;255;128;0;48;5;196"),
		"color: rgb(255, 128, 0); background-color: rgb(255, 0, 0)",
	);
	// Inverse swaps the colors, the defaults when there are none.
	assert.equal(sgrCss("7"), "color: var(--tui-bg); background-color: var(--tui-fg)");
	assert.equal(sgrCss("7;32"), "color: var(--tui-bg); background-color: var(--tui-color-2)");
	assert.equal(
		sgrCss("2;3;4:3;9"),
		"opacity: 0.6; font-style: italic; text-decoration-line: underline line-through; text-decoration-style: wavy",
	);
});

test("a row is a run of text per style, and a wide grapheme takes two cells' width", () => {
	const { document } = dom();
	const b = new CellBuffer(8, 1);
	b.writeString(0, 0, "ab", "1");
	b.writeString(2, 0, "漢c");
	const row = drawRow(document, b.rows[0]);
	assert.equal(
		row.innerHTML,
		'<span style="font-weight: bold">ab</span><span class="wide">漢</span>c   ',
	);
});

test("a page's keys are a terminal's: Ctrl+letter lowercase, the page keeps its own shortcuts", () => {
	const key = (init, opts) =>
		keyOf({ ctrlKey: false, altKey: false, shiftKey: false, ...init }, opts);
	assert.deepEqual(key({ key: "Tab", shiftKey: true }), {
		kind: "key",
		key: "Tab",
		ctrlKey: false,
		altKey: false,
		shiftKey: true,
	});
	assert.equal(key({ key: "A", ctrlKey: true, shiftKey: true }).key, "a");
	assert.equal(key({ key: "Shift" }), null);
	assert.equal(key({ key: "r", metaKey: true }), null);
	assert.equal(key({ key: "v", ctrlKey: true }), null); // The paste event brings it.
	assert.equal(key({ key: "c", ctrlKey: true }, { hasSelection: true }), null);
	assert.equal(key({ key: "c", ctrlKey: true }).key, "c");
});

test("mirrorTui shows another host's state, and what's done on its screen runs on that host", () => {
	const source = new Host({ schedule: () => () => {} });
	source.scope.register({ Counter });
	source.start(source.scope.components.Counter({ count: 4 }));
	const mirror = mirrorTui(source, { width: 30, height: 4 });
	const { screen } = mirror;
	assert.match(screen.toString(), /│ − │ 4 │ \+ │/);
	const rows = screen.toString().split("\n");
	const y = rows.findIndex((r) => r.includes("+"));
	screen.click(rows[y].indexOf("+"), y);
	assert.equal(source.root.count, 5, "the click ran on source");
	assert.equal(mirror.host.root.count, 4, "it shows source's state once synced");
	mirror.sync();
	screen.flush();
	assert.match(screen.toString(), /│ 5 │/);
	mirror.stop();
	source.start(source.scope.components.Counter({ count: 9 }));
	mirror.sync();
	assert.equal(mirror.host.root, null, "a stopped mirror stays stopped");
});

test("<tutuca-terminal> shows the app a request finds and runs its keys on that app's host", async () => {
	const window = dom("<main><div id=app></div><section id=term></section></main>");
	const { document } = window;
	defineTutucaTerminal(window);
	const host = new Host({ document, rootNode: document.getElementById("app") });
	host.scope.register({ Counter });
	host.start(host.scope.components.Counter({ count: 1 }));
	let mirror = null;
	const section = document.getElementById("term");
	section.addEventListener(TERMINAL_REQUEST, (e) => {
		assert.equal(e.detail.key, "counter");
		mirror = e.detail.show(host);
	});
	const terminal = document.createElement("tutuca-terminal");
	terminal.setAttribute("app-key", "counter");
	terminal.setAttribute("cols", "20");
	terminal.setAttribute("rows", "3");
	section.append(terminal);
	assert.notEqual(mirror, null);
	const screen = terminal.shadowRoot.querySelector(".screen");
	const text = () => [...screen.children].map((row) => row.textContent.trimEnd()).join("\n");
	assert.equal(text(), "╭───╮   ╭───╮\n│ − │ 1 │ + │\n╰───╯   ╰───╯");
	assert.equal(
		screen.querySelector("span[style]").getAttribute("style"),
		"color: var(--tui-color-6); font-weight: bold",
	);
	const press = (key, init = {}) => {
		const e = new window.KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
			...init,
		});
		screen.dispatchEvent(e);
		return e;
	};
	press("Tab");
	press("Tab"); // +
	const enter = press("Enter");
	assert.equal(enter.defaultPrevented, true, "the page doesn't get the terminal's keys");
	await host.whenIdle();
	assert.equal(host.root.count, 2);
	mirror.sync(); // As the page's host renders.
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.match(text(), /│ 2 │/);
	// Out of the page, it lets go.
	terminal.remove();
	await Promise.resolve();
	assert.equal(mirror.stopped, true);
});
