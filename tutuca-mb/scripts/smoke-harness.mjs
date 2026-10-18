// Backend loading and document lifetime for the shared DOM smoke scenarios.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "../../node_modules/jsdom/lib/api.js";
import { instantiate } from "../wasm/loader.mjs";
import { counter, demos, settle, storybook, todo } from "./smoke-scenarios.mjs";

export async function runSmoke(backend, names) {
	for (const name of names) {
		const selector = name === "storybook" ? "#storybook" : "#app";
		const children =
			name === "counter"
				? '<tutuca-app app-key="counter"></tutuca-app><tutuca-app app-key="counter:10"></tutuca-app><tutuca-app app-key="nothing"></tutuca-app>'
				: "";
		const dom = new JSDOM(`<!doctype html><div id="${selector.slice(1)}">${children}</div>`);
		const { window } = dom;
		const keys = [
			"window",
			"document",
			"customElements",
			"HTMLElement",
			"devtoolsFormatters",
			"tutuca",
			"setTimeout",
		];
		const saved = new Map(
			keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
		);
		const originalError = console.error;
		const errors = [];
		const timers = new Set();
		const timeout = globalThis.setTimeout;
		try {
			globalThis.setTimeout = (fn, ms, ...args) => {
				const timer = timeout(() => {
					timers.delete(timer);
					fn(...args);
				}, ms);
				timers.add(timer);
				return timer;
			};
			Object.assign(globalThis, {
				window,
				document: window.document,
				customElements: window.customElements,
				HTMLElement: window.HTMLElement,
				devtoolsFormatters: [],
				tutuca: {},
			});
			console.error = (...args) => {
				const text = args.join(" ");
				if (!text.startsWith("Could not parse CSS stylesheet")) errors.push(text);
			};
			const start = async () => {
				if (backend === "js") {
					const entry = name === "storybook" ? "storybook.js" : "web/web.js";
					await import(`../_build/js/debug/build/examples/${name}/${entry}`);
				} else {
					const file = new URL(
						`../_build/wasm-gc/debug/build/examples/${name}/wasm/wasm.wasm`,
						import.meta.url,
					);
					const instance = await instantiate(await readFile(file), { document: window.document });
					const result =
						name === "storybook"
							? instance.exports.start(selector, "")
							: instance.exports.start(selector);
					assert.equal(result, 1);
				}
			};
			if (name === "counter") {
				await counter(window, start);
			} else {
				await start();
				await settle();
				const check = name === "todo" ? todo : name === "storybook" ? storybook : demos[name];
				await check(window.document.querySelector(selector), window);
			}
			assert.deepEqual(errors, [], `${backend} ${name}: no problems`);
			console.log(`${backend} ${name} ok`);
		} finally {
			// Stop queued renders before disconnecting their DOM. Disposals may queue more.
			for (const timer of timers) clearTimeout(timer);
			window.close();
			await Promise.resolve();
			for (const timer of timers) clearTimeout(timer);
			console.error = originalError;
			for (const [key, descriptor] of saved) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else delete globalThis[key];
			}
		}
	}
}
