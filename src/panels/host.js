// The Host of a UI of panels over story apps, shared by the storybook and the playground.

import { ClassCompiler, classNamesOf } from "../css/classes.js";
import { REQUEST } from "../embed/element.js";
import { storyAskHandlers } from "../stories/live.js";
import { Host, isProblem, problemLines } from "../tutuca.js";

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
// Logs what goes wrong in host (failed tasks, invalid states, ...), and compiles classes, the
// class names of its UI, into style.
export const watchPanelHost = (host, { compile, classes, style }) => {
	host.listen((record) => {
		if (isProblem(record)) console.error(problemLines(record).join("\n"), record);
	});
	new ClassCompiler(compile, classes).watch(style);
};
// The class names a UI made of components and the panels builds.
export const uiClasses = (components) => classNamesOf(Object.values(components));
// The class names the stories of books build.
export const bookClasses = (books) =>
	classNamesOf(books.flatMap((book) => Object.values(book.components)));
