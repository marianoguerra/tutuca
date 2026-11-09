// The Host of a UI of panels over story apps, shared by the storybook and the playground.

import { problemLines } from "../core/text.js";
import { ClassCompiler, classNamesOf } from "../css/classes.js";
import { REQUEST } from "../embed/element.js";
import { Host, isProblem } from "../tutuca.js";
import { storyAskHandlers } from "./runner.js";
import { panelClassNames } from "./ui/panels.js";

// A Host on rootNode with components registered: the <tutuca-app> requests in rootNode mount
// on registryOf()'s StoryRegistry, and the panels' asks run on it, besides askHandlers.
export const startPanelHost = ({
	document,
	rootNode,
	components,
	registryOf,
	askHandlers = {},
	checks = null,
}) => {
	rootNode.addEventListener(REQUEST, (e) => registryOf()?.mount(e.detail));
	const host = new Host({ document, rootNode, checks });
	host.scope.register(components);
	host.scope.registerAskHandlers({ ...storyAskHandlers(registryOf), ...askHandlers });
	return host;
};
// Logs what goes wrong in host (failed tasks, invalid states, ...), and compiles the classes
// its views compute as they render into style.
export const watchPanelHost = (host, { rootNode, compile, classes, style }) => {
	host.listen((record) => {
		if (isProblem(record)) console.error(problemLines(record).join("\n"), record);
	});
	new ClassCompiler(compile, classes).attach(host, rootNode, style);
};
// The class names a UI made of components and the panels builds.
export const uiClasses = (components) => classNamesOf(Object.values(components), panelClassNames);
// The class names the stories of books build.
export const bookClasses = (books) =>
	classNamesOf(books.flatMap((book) => Object.values(book.components)));
