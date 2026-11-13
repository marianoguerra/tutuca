// <tutuca-terminal>: a terminal preview on a page. It shows another host's app as a terminal
// shows it (its components' renders.tui, through mirrorTui) and takes the page's keys, mouse
// and paste as a terminal would (web.js), and what they send runs on that host. So the app on
// the page and the one in the preview are one app.
//
// el.show(host) starts it on host and returns the mirror ({ sync, stop, stopped, ... }); call
// mirror.sync() after host renders, which draws it too. With app-key, it asks its ancestors for the host instead,
// as <tutuca-app> asks for an app: TERMINAL_REQUEST, a bubbling CustomEvent with detail
// { key, show(host) → mirror | null }, on connect and when app-key changes; show returns null
// once the element asked again or let go of it.
//
// It fits as many cells as its box holds, as a terminal window does; cols and rows fix either.
// Its height is 24 rows, or its rows, unless the page says otherwise. Shift+drag selects text, and focus
// stays in it, Tab and all, until it's clicked out of.
import { mirrorTui } from "./terminal.js";
import { bindScreen, drawBuffer } from "./web.js";

export const TERMINAL_REQUEST = "tutucaterminal";

// xterm's dark palette, near enough, for the 16 colors; a page sets the variables to theme it.
const PALETTE = [
	"#1e1e1e",
	"#cd3131",
	"#0dbc79",
	"#e5e510",
	"#2472c8",
	"#bc3fbc",
	"#11a8cd",
	"#e5e5e5",
	"#666666",
	"#f14c4c",
	"#23d18b",
	"#f5f543",
	"#3b8eea",
	"#d670d6",
	"#29b8db",
	"#ffffff",
];
const STYLE = `
:host {
	display: block;
	--tui-fg: #d4d4d4;
	--tui-bg: #1e1e1e;
	${PALETTE.map((c, i) => `--tui-color-${i}: ${c};`).join(" ")}
	--tui-font: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
	--tui-font-size: 13px;
	/* Tight enough that box drawing joins from row to row, as in a terminal. */
	--tui-line: 1.1;
	--tui-rows: 24;
	font-family: var(--tui-font);
	font-size: var(--tui-font-size);
	line-height: var(--tui-line);
	height: calc(var(--tui-rows) * 1lh);
	padding: 6px 8px;
	border-radius: 6px;
	background: var(--tui-bg);
	color: var(--tui-fg);
}
:host(:focus-within) { outline: 2px solid var(--tui-color-4); outline-offset: 1px; }
.screen, .probe {
	font-family: var(--tui-font);
	font-size: var(--tui-font-size);
	line-height: var(--tui-line);
	font-variant-ligatures: none;
	white-space: pre;
}
.screen { height: 100%; overflow: hidden; outline: none; cursor: default; user-select: text; }
.wide { display: inline-block; width: 2ch; }
.probe { position: absolute; visibility: hidden; pointer-events: none; }
.note { font: 12px ui-sans-serif, system-ui, sans-serif; opacity: 0.7; }
`;

const PROBE = "0123456789";

// Defines the element in window once; returns its class.
export const defineTutucaTerminal = (window) => {
	const existing = window.customElements.get("tutuca-terminal");
	if (existing !== undefined) return existing;
	class TutucaTerminal extends window.HTMLElement {
		static observedAttributes = ["app-key", "cols", "rows"];
		mirror = null;
		current = null; // The detail of the live request: an older one's show does nothing.
		drawn = [];
		scheduled = false;
		connectedCallback() {
			this.setUp();
			if (this.hasAttribute("app-key") && this.current?.key !== this.key) this.request();
		}
		disconnectedCallback() {
			queueMicrotask(() => {
				if (!this.isConnected) this.release();
			});
		}
		attributeChangedCallback(name, _old, value) {
			if (name === "rows") {
				const rows = Number.parseInt(value ?? "", 10);
				if (rows > 0) this.style.setProperty("--tui-rows", String(rows));
				else this.style.removeProperty("--tui-rows");
			}
			if (!this.isConnected) return;
			if (name === "app-key") this.request();
			else this.fit();
		}
		get key() {
			return this.getAttribute("app-key");
		}
		setUp() {
			if (this.shadowRoot !== null) return;
			const shadow = this.attachShadow({ mode: "open" });
			const doc = this.ownerDocument;
			const style = doc.createElement("style");
			style.textContent = STYLE;
			this.screenNode = doc.createElement("div");
			this.screenNode.className = "screen";
			this.screenNode.tabIndex = 0;
			this.screenNode.setAttribute("role", "application");
			this.screenNode.setAttribute("aria-label", "Terminal preview");
			this.probe = doc.createElement("span");
			this.probe.className = "probe";
			this.probe.setAttribute("aria-hidden", "true");
			this.probe.textContent = PROBE;
			shadow.append(style, this.probe, this.screenNode);
			const { ResizeObserver } = window;
			if (ResizeObserver !== undefined) {
				this.resizes = new ResizeObserver(() => this.fit());
				this.resizes.observe(this);
			}
		}
		request() {
			this.release();
			const key = this.key;
			const detail = {
				key,
				show: (host) => (this.current === detail ? this.show(host) : null),
			};
			this.current = detail;
			this.dispatchEvent(new window.CustomEvent(TERMINAL_REQUEST, { bubbles: true, detail }));
			if (this.mirror === null) this.note(`Waiting for ${key}…`);
		}
		// Shows host's app in it, until release or another show; returns the mirror.
		show(host) {
			this.setUp();
			this.stopMirror();
			const { cols, rows } = this.size();
			const mirror = mirrorTui(host, { width: cols, height: rows });
			// Synced, it draws at once: what host rendered shows with it.
			const { sync } = mirror;
			mirror.sync = () => {
				sync();
				if (this.mirror === mirror) this.draw();
			};
			this.mirror = mirror;
			const { screen } = mirror;
			this.screenNode.replaceChildren();
			this.drawn = [];
			screen.document.onInvalidate = () => this.schedule();
			this.unbind = bindScreen(this.screenNode, screen, {
				cellAt: (e) => this.cellAt(e),
				rowHeight: () => this.cell().height,
			});
			this.draw();
			return mirror;
		}
		// The cell size of its font, in pixels: 0 when nothing's laid out (a page not shown yet).
		cell() {
			const rect = this.probe.getBoundingClientRect();
			return { width: rect.width / PROBE.length, height: rect.height };
		}
		// The columns and rows its box holds, or its cols and rows; 80 by 24 when it can't tell.
		size() {
			const { width, height } = this.cell();
			const fits = (attr, room, unit, fallback) => {
				const fixed = Number.parseInt(this.getAttribute(attr) ?? "", 10);
				if (fixed > 0) return fixed;
				if (!(unit > 0) || !(room > 0)) return fallback;
				return Math.max(1, Math.floor(room / unit));
			};
			const box = this.screenNode;
			return {
				cols: fits("cols", box.clientWidth, width, 80),
				rows: fits("rows", box.clientHeight, height, 24),
			};
		}
		// The cell under a mouse event, clamped to the screen.
		cellAt(e) {
			const rect = this.screenNode.getBoundingClientRect();
			const { width, height } = this.cell();
			const { screen } = this.mirror;
			const clamp = (v, max) => Math.min(max - 1, Math.max(0, Number.isFinite(v) ? v : 0));
			return {
				x: clamp(Math.floor((e.clientX - rect.left) / width), screen.width),
				y: clamp(Math.floor((e.clientY - rect.top) / height), screen.height),
			};
		}
		fit() {
			if (this.mirror === null) return;
			const { cols, rows } = this.size();
			const { screen } = this.mirror;
			if (cols === screen.width && rows === screen.height) return;
			screen.resize(cols, rows);
			this.draw();
		}
		// Paints what changed, once per frame however many changes the frame brings.
		schedule() {
			if (this.scheduled) return;
			this.scheduled = true;
			const run = () => {
				this.scheduled = false;
				this.draw();
			};
			if (window.requestAnimationFrame !== undefined) window.requestAnimationFrame(run);
			else queueMicrotask(run);
		}
		// Paints the screen, if anything changed, and draws its cells.
		draw() {
			if (this.mirror === null) return;
			const { screen } = this.mirror;
			screen.flush();
			if (screen.buffer === null) return;
			const doc = this.ownerDocument;
			this.drawn = drawBuffer(doc, this.screenNode, screen.buffer, this.drawn);
		}
		note(text) {
			const p = this.ownerDocument.createElement("p");
			p.className = "note";
			p.textContent = text;
			this.screenNode.replaceChildren(p);
		}
		stopMirror() {
			this.unbind?.();
			this.unbind = null;
			this.mirror?.stop();
			this.mirror = null;
		}
		// Lets go of the host it shows, and of its request.
		release() {
			this.current = null;
			this.stopMirror();
		}
	}
	window.customElements.define("tutuca-terminal", TutucaTerminal);
	return TutucaTerminal;
};
