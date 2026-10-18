import * as fc from "fast-check";
import { compile } from "margaui";
import { ClassCompiler, classNamesOf } from "./src/css/classes.js";
import { installFormatters } from "./src/dev/formatters.js";
import { startStorybook, storybookClasses } from "./src/storybook/index.js";
import { books } from "./storybook.books.js";

installFormatters();
const storySpecs = new Set(books.flatMap((book) => Object.values(book.components)));
const storyClasses = classNamesOf(storySpecs);
const [uiCss, storyCss] = await Promise.all([compile(storybookClasses()), compile(storyClasses)]);
document.getElementById("margaui").textContent = uiCss;
const rootNode = document.getElementById("storybook");
// The storybook's own computed classes too, after each render.
const uiClasses = new ClassCompiler(compile, storybookClasses());
const { host } = startStorybook({
	document,
	rootNode,
	fc,
	books,
	css: storyCss,
	// Classes stories compute in methods and loops compile as they show up.
	compile: (classes) => compile(classes),
	known: storyClasses,
	initialId: decodeURIComponent(location.hash.slice(1)),
});
const extraStyle = document.head.appendChild(document.createElement("style"));
uiClasses.watch(rootNode, extraStyle);
host.onNotify = (type, info) => {
	if (type === "render") uiClasses.scan(rootNode);
	if (type === "taskFailed" || type === "stateInvalid") console.error(type, info);
};
