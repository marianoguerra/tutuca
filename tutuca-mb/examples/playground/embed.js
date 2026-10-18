// <tutuca-playground example="counter" [story="Counter/From ten"] [backend="wasm-gc"] [eager]>:
// a playground for one example, embedded in a page, as many times as the page likes. `backend`
// is what its runs compile to, js unless it says wasm-gc; changing it runs again. It loads its files when it
// connects and runs them when it first scrolls into view (or at once, with `eager`), or on Run.
// Every playground on the page shares the one compiler `compiler()` gives, which compiles one
// run at a time. element.js defines it with the page's compiler and editor; the smoke script
// with its own.
import { examples as allExamples } from "./examples.js";
import { mountPlayground } from "./playground.js";

export const definePlayground = ({
	window = globalThis.window,
	compiler,
	createEditor,
	examples = allExamples,
	base = new URL("./examples.js", import.meta.url).href,
	fetch,
	importRun,
	startRun,
	tagName = "tutuca-playground",
}) => {
	const defined = window.customElements.get(tagName);
	if (defined !== undefined) return defined;
	class TutucaPlayground extends window.HTMLElement {
		static observedAttributes = ["backend"];
		playground = null;
		loading = null;

		attributeChangedCallback() {
			void this.playground?.setBackend(this.getAttribute("backend") ?? "js");
		}

		connectedCallback() {
			if (this.playground !== null) return;
			const wanted = this.getAttribute("example");
			const example = examples.find((e) => e.id === wanted) ?? examples[0];
			this.playground = mountPlayground(this, {
				compiler: compiler(),
				createEditor,
				examples: [example],
				base,
				backend: this.getAttribute("backend") ?? "js",
				...(fetch ? { fetch } : {}),
				...(importRun ? { importRun } : {}),
				...(startRun ? { startRun } : {}),
			});
			this.loading = this.playground.load(example.id, {
				story: this.getAttribute("story") ?? "",
				run: false,
			});
			if (this.hasAttribute("eager")) {
				void this.start();
			} else if (window.IntersectionObserver !== undefined) {
				const seen = new window.IntersectionObserver((entries) => {
					if (entries.some((e) => e.isIntersecting)) {
						seen.disconnect();
						void this.start();
					}
				});
				seen.observe(this);
			}
		}

		// Runs once its files are in, unless a run already happened (the Run button).
		async start() {
			await this.loading;
			if (this.playground.state.run === 0 && this.playground.state.status === "idle") {
				await this.playground.run();
			}
		}
	}
	window.customElements.define(tagName, TutucaPlayground);
	return TutucaPlayground;
};
