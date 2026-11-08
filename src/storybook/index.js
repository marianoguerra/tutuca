// A storybook for tutuca components. Projects register books of stories: an initial state,
// named sequences of steps and a property based testing config. The UI, made with tutuca,
// shows each story as an isolated app in <tutuca-app>, steps through its sequences, sends
// single messages and stress tests it with generated message or event sequences.
// fast-check is passed in, as in pbt.js.

import { DevChecks } from "../dev/checks.js";

export { StoryRegistry } from "./runner.js";
export { checkStory, prepareStory, step, stories, stressStory } from "./stories.js";

import { defineTutucaApp } from "../embed/element.js";
import { bookClasses, startPanelHost, uiClasses, watchPanelHost } from "./host.js";
import { StoryRegistry } from "./runner.js";
import { StoryLink } from "./ui/link.js";
import { makePanels, panelComponents } from "./ui/panels.js";
import { Storybook } from "./ui/storybook.js";

export const storybookComponents = { Storybook, StoryLink, ...panelComponents };

export const storybookClasses = () => uiClasses(storybookComponents);

// The storybook root for books, with initialId selected when it names a story.
const makeStorybook = (C, books, initialId = "") => {
	const links = books.flatMap((book) =>
		book.stories.map((story, i) =>
			C.StoryLink({
				id: story.id,
				group: book.title,
				name: story.name,
				showGroup: i === 0,
				groupSize: book.stories.length,
				isGenerated: story.arbitrary !== undefined,
				isSelected: story.id === initialId,
			}),
		),
	);
	const selected = links.find((l) => l.isSelected);
	return C.Storybook({
		links,
		selectedId: selected?.id ?? "",
		isGenerated: selected?.isGenerated ?? false,
		...makePanels(C, `${selected?.id ?? ""}@0`),
	});
};

// Starts the storybook UI on rootNode. css and links style the stories' shadow roots.
export const startStorybook = ({
	document,
	rootNode,
	fc,
	books,
	css = "",
	links = [],
	compile = null,
	known = [],
	initialId = "",
	dev = true,
}) => {
	defineTutucaApp(document.defaultView);
	const registry = new StoryRegistry({ fc, books, css, links, compile, known });
	const host = startPanelHost({
		document,
		rootNode,
		components: storybookComponents,
		registryOf: () => registry,
		checks: dev ? DevChecks : null,
		askHandlers: {
			scrollToTop: () => {
				for (const node of [
					rootNode.querySelector("[data-story-main]"),
					document.scrollingElement,
				]) {
					if (node) node.scrollTop = 0;
				}
			},
			// The story's id as the URL's hash, which initialId reads on a reload; replaced, so
			// picking stories doesn't fill the history.
			rememberStory: ([id]) => {
				const history = document.defaultView?.history;
				history?.replaceState(history.state, "", `#${encodeURI(id)}`);
			},
		},
	});
	host.start(makeStorybook(host.scope.components, books, initialId));
	return { host, registry };
};

// Opens the storybook for books on a page: compile (class names → css) styles its UI into
// uiStyle and the stories in their shadow roots, the classes views compute as they render
// included. Failed tasks and invalid states are logged.
export const openStorybook = async ({
	document,
	rootNode,
	uiStyle,
	fc,
	books,
	compile,
	initialId = "",
}) => {
	const known = bookClasses(books);
	const [uiCss, css] = await Promise.all([compile(storybookClasses()), compile(known)]);
	uiStyle.textContent = uiCss;
	const started = startStorybook({ document, rootNode, fc, books, css, compile, known, initialId });
	watchPanelHost(started.host, {
		rootNode,
		compile,
		classes: storybookClasses(),
		style: document.head.appendChild(document.createElement("style")),
	});
	return started;
};
