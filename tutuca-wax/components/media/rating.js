// tw-rating, the custom element components/media's Rating holds: five stars
// in its shadow root. It shows what its stars property (or attribute) says
// and, when a star is clicked, fires rating-change, a bubbling CustomEvent
// whose detail is that star's number; it doesn't change itself, the
// component that holds it sets stars back.

// Defines tw-rating in win's registry, once; win is the window whose
// documents will make it (each jsdom window has its own).
export function defineRating(win = globalThis) {
	if (win.customElements.get("tw-rating")) return;
	class Rating extends win.HTMLElement {
		static observedAttributes = ["stars"];
		#stars = 0;
		constructor() {
			super();
			const root = this.attachShadow({ mode: "open" });
			root.innerHTML =
				"<style>button{border:0;background:none;padding:0 .1em;font-size:1.5em;cursor:pointer;color:#f5a623}</style>";
			for (let n = 1; n <= 5; n++) {
				const star = win.document.createElement("button");
				star.type = "button";
				star.title = `${n} of 5`;
				star.addEventListener("click", () => {
					this.dispatchEvent(new win.CustomEvent("rating-change", { detail: n, bubbles: true }));
				});
				root.append(star);
			}
			this.#show();
		}
		get stars() {
			return this.#stars;
		}
		set stars(n) {
			this.#stars = Number(n) || 0;
			this.#show();
		}
		attributeChangedCallback(_name, _old, value) {
			this.stars = value;
		}
		#show() {
			for (const [i, star] of [...this.shadowRoot.querySelectorAll("button")].entries()) {
				star.textContent = i < this.#stars ? "★" : "☆";
			}
		}
	}
	win.customElements.define("tw-rating", Rating);
}
