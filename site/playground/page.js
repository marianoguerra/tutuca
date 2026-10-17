// The playground page: an example selector over every example, kept in the URL hash as
// #example/story id.
import "./boot.js";
import { examples } from "./examples.js";

const playground = document.querySelector("tutuca-playground");
const [example = "", ...story] = decodeURIComponent(location.hash.slice(1)).split("/");
playground.setExamples(examples);
await playground.loadExample(example, story.join("/"));
playground.addEventListener("playgroundchange", (e) => {
	const { example, story } = e.detail;
	history.replaceState(null, "", `#${encodeURIComponent(example)}${story ? `/${story}` : ""}`);
});

// margaui's dark theme is opt-in: follow the system.
const dark = matchMedia("(prefers-color-scheme: dark)");
const syncTheme = () => {
	document.documentElement.dataset.theme = dark.matches ? "dark" : "light";
};
syncTheme();
dark.addEventListener("change", syncTheme);
