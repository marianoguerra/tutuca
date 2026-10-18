// The playground page: the editor, the compiler worker and the examples, with the example and
// story in the URL's hash (#counter or #counter/Counter/From ten) and the backend in its query
// (?backend=wasm-gc; js when there's none).
import { compile } from "margaui";
import { createEditor } from "./deps/editor.js";
import { sharedCompiler } from "./element.js";
import { examples } from "./examples.js";
import { mountPlayground, playgroundClasses } from "./playground.js";

const compiler = sharedCompiler();

const fromHash = () => {
	const hash = decodeURIComponent(location.hash.slice(1));
	const at = hash.indexOf("/");
	return at < 0 ? { example: hash, story: "" } : { example: hash.slice(0, at), story: hash.slice(at + 1) };
};

const url = () => new URL(location.href);
const playground = mountPlayground(document.getElementById("playground"), {
	compiler,
	createEditor,
	examples,
	base: import.meta.url,
	backend: url().searchParams.get("backend") ?? "js",
	onChange: ({ example, story, backend }) => {
		const next = url();
		if (backend !== undefined) {
			if (backend === "js") next.searchParams.delete("backend");
			else next.searchParams.set("backend", backend);
		} else {
			next.hash = `#${encodeURIComponent(example)}${story ? `/${story}` : ""}`;
		}
		history.replaceState(null, "", next);
	},
});

// For the console: playground.editor, playground.run(), playground.state.
window.playground = playground;

const classes = new Set(playgroundClasses);
for (const node of document.querySelectorAll("[class]")) for (const c of node.classList) classes.add(c);
document.getElementById("page").textContent = await compile([...classes]);

const { example, story } = fromHash();
void playground.load(example, { story });
window.addEventListener("hashchange", () => {
	const next = fromHash();
	if (next.example !== playground.state.example) void playground.load(next.example, { story: next.story });
});
