// <tutuca-canvas>: a canvas preview on a page, as <tutuca-terminal> is a terminal one. It shows
// another host's app (its components' renders.tui, through mirrorCanvas) on a <canvas>, takes the
// page's keys, mouse and paste as a terminal would, and what they send runs on that host.
//
// mode is "text" (the default: laid out in pixels, a proportional font) or "grid" (in cells, a
// monospace one). It fits its box, as many pixels or cells as it holds, and is 16 lines tall
// unless its rows or the page says otherwise; font-size and font-family change the typeface
// (--tui-font-size and --tui-font too), and --tui-fg, --tui-bg and --tui-color-0 to 15 its
// colors. el.show(host) starts it on host and returns the mirror ({ sync, stop, ... }); call
// mirror.sync() after host renders.
import { bindCanvas, CanvasScreen, DEFAULT_THEME, DEFAULT_TYPEFACE } from "./canvas.js";
import { mirrorTui } from "./terminal.js";

const STYLE = `
:host {
	display: block;
	position: relative;
	--tui-rows: 16;
	height: calc(var(--tui-rows) * 1.35em + 12px);
	padding: 6px 8px;
	border-radius: 6px;
	background: var(--tui-bg, ${DEFAULT_THEME.bg});
	box-sizing: border-box;
}
:host(:focus-within) { outline: 2px solid var(--tui-color-4, #2472c8); outline-offset: 1px; }
/* Out of the flow, so its pixels never size the element it fits. */
canvas { position: absolute; inset: 6px 8px; width: calc(100% - 16px); height: calc(100% - 12px);
	display: block; outline: none; cursor: default; }
`;
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const defineTutucaCanvas = (window) => {
	const existing = window.customElements.get("tutuca-canvas");
	if (existing !== undefined) return existing;
	class TutucaCanvas extends window.HTMLElement {
		static observedAttributes = ["mode", "rows", "font-size", "font-family"];
		mirror = null;
		host = null;
		scheduled = false;
		connectedCallback() {
			this.setUp();
		}
		disconnectedCallback() {
			queueMicrotask(() => {
				if (!this.isConnected) this.stopMirror();
			});
		}
		attributeChangedCallback(name, _old, value) {
			if (name === "rows") {
				const rows = Number.parseInt(value ?? "", 10);
				if (rows > 0) this.style.setProperty("--tui-rows", String(rows));
				else this.style.removeProperty("--tui-rows");
			}
			// A new mode or typeface is a new screen, on the same host.
			if (this.host !== null && name !== "rows") this.show(this.host);
		}
		get mode() {
			return this.getAttribute("mode") === "grid" ? "grid" : "text";
		}
		setUp() {
			if (this.shadowRoot !== null) return;
			const shadow = this.attachShadow({ mode: "open" });
			const doc = this.ownerDocument;
			const style = doc.createElement("style");
			style.textContent = STYLE;
			this.canvas = doc.createElement("canvas");
			this.canvas.tabIndex = 0;
			this.canvas.setAttribute("role", "application");
			this.canvas.setAttribute("aria-label", "Canvas preview");
			shadow.append(style, this.canvas);
			const { ResizeObserver } = window;
			if (ResizeObserver !== undefined) {
				this.resizes = new ResizeObserver(() => this.fit());
				this.resizes.observe(this);
			}
		}
		// What it's drawn in: the page's variables over the defaults.
		typeface() {
			const css = window.getComputedStyle(this);
			const size =
				Number.parseFloat(this.getAttribute("font-size") ?? "") ||
				Number.parseFloat(css.getPropertyValue("--tui-font-size")) ||
				DEFAULT_TYPEFACE.size;
			const family =
				this.getAttribute("font-family") ??
				(css.getPropertyValue("--tui-font").trim() ||
					(this.mode === "grid" ? DEFAULT_TYPEFACE.family : SANS));
			return { family, size, lineHeight: DEFAULT_TYPEFACE.lineHeight };
		}
		theme() {
			const css = window.getComputedStyle(this);
			const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
			return {
				fg: v("--tui-fg", DEFAULT_THEME.fg),
				bg: v("--tui-bg", DEFAULT_THEME.bg),
				palette: DEFAULT_THEME.palette.map((c, i) => v(`--tui-color-${i}`, c)),
			};
		}
		// The CSS size of its canvas, and the device pixels it's drawn at.
		size() {
			const rect = this.canvas.getBoundingClientRect();
			return {
				width: Math.max(1, Math.floor(rect.width || 640)),
				height: Math.max(1, Math.floor(rect.height || 320)),
				ratio: window.devicePixelRatio || 1,
			};
		}
		sizeCanvas({ width, height, ratio }) {
			this.canvas.width = Math.round(width * ratio);
			this.canvas.height = Math.round(height * ratio);
		}
		// Shows host's app in it, until stop or another show; returns the mirror, or null without a
		// 2D context.
		show(host) {
			this.setUp();
			this.stopMirror();
			this.host = host;
			const size = this.size();
			this.sizeCanvas(size);
			const context = this.canvas.getContext("2d");
			// Where there's no 2D canvas (jsdom, a browser that's turned it off), it says so.
			if (context === null) {
				this.canvas.hidden = true;
				this.shadowRoot.querySelector("p")?.remove();
				const note = this.ownerDocument.createElement("p");
				note.textContent = "No 2D canvas to draw on here.";
				note.style.color = "var(--tui-fg, #d4d4d4)";
				this.shadowRoot.append(note);
				return null;
			}
			const screen = new CanvasScreen({
				context,
				mode: this.mode,
				width: size.width,
				height: size.height,
				pixelRatio: size.ratio,
				typeface: this.typeface(),
				theme: this.theme(),
			});
			const mirror = mirrorTui(host, { screen });
			const { sync } = mirror;
			mirror.sync = () => {
				sync();
				if (this.mirror === mirror) screen.flush();
			};
			this.mirror = mirror;
			screen.document.onInvalidate = () => this.schedule();
			this.unbind = bindCanvas(this.canvas, screen);
			screen.flush();
			return mirror;
		}
		fit() {
			if (this.mirror === null) return;
			const size = this.size();
			const { screen } = this.mirror;
			if (this.canvas.width === Math.round(size.width * size.ratio)) {
				if (this.canvas.height === Math.round(size.height * size.ratio)) return;
			}
			this.sizeCanvas(size);
			screen.pixelRatio = size.ratio;
			screen.document.dirty = true;
			screen.resizePixels(size.width, size.height);
			screen.flush();
		}
		// Paints what changed, once per frame.
		schedule() {
			if (this.scheduled) return;
			this.scheduled = true;
			const run = () => {
				this.scheduled = false;
				this.mirror?.screen.flush();
			};
			if (window.requestAnimationFrame !== undefined) window.requestAnimationFrame(run);
			else queueMicrotask(run);
		}
		stopMirror() {
			this.unbind?.();
			this.unbind = null;
			this.mirror?.stop();
			this.mirror = null;
		}
	}
	window.customElements.define("tutuca-canvas", TutucaCanvas);
	return TutucaCanvas;
};
