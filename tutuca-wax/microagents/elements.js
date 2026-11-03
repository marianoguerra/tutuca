// The custom elements agents' views draw charts with (an agent can't ship
// JS, so the page defines them): <ma-svg svg="..."> shows SVG text (what
// echarts_svg renders), <ma-vega spec="..."> renders a Vega-Lite spec (JSON
// text, its data inlined) with vega-embed, which works asynchronously.
import { loadBundle } from "./engines/index.js";

const attrElement = (name, attr, draw) => {
	if (!globalThis.customElements || customElements.get(name)) return;
	customElements.define(
		name,
		class extends HTMLElement {
			static observedAttributes = [attr];
			attributeChangedCallback() {
				draw(this, this.getAttribute(attr) ?? "");
			}
			connectedCallback() {
				draw(this, this.getAttribute(attr) ?? "");
			}
		},
	);
};

export function defineChartElements() {
	attrElement("ma-svg", "svg", (el, svg) => {
		el.innerHTML = svg;
	});
	attrElement("ma-vega", "spec", async (el, text) => {
		const mine = (el.drawing = Symbol());
		if (text === "") {
			el.textContent = "";
			return;
		}
		try {
			const { embed } = await loadBundle("vega");
			if (el.drawing !== mine) return;
			el.textContent = "";
			await embed(el, JSON.parse(text), { actions: false, renderer: "svg" });
		} catch (error) {
			if (el.drawing === mine) el.textContent = `can't draw it: ${error.message}`;
		}
	});
}
