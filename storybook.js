import * as fc from "fast-check";
import { compile } from "margaui";
import { installFormatters } from "./src/dev/formatters.js";
import { openStorybook } from "./src/storybook/index.js";
import { books } from "./storybook.books.js";

installFormatters();
await openStorybook({
	document,
	rootNode: document.getElementById("storybook"),
	uiStyle: document.getElementById("margaui"),
	fc,
	books,
	compile,
	initialId: decodeURIComponent(location.hash.slice(1)),
});
