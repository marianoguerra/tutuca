// A storybook for tutuca components. Projects register books of stories: an initial state,
// named sequences of steps and a property based testing config. The UI, made with tutuca,
// shows each story as an isolated app in <tutuca-app>, steps through its sequences, sends
// single messages and stress tests it with generated message or event sequences.
// fast-check is passed in, as in pbt.js.

import { classNamesOf } from "../css/classes.js";
import { makeDevPanel } from "../dev/panel.js";
import { Host } from "../tutuca.js";

export { StoryRegistry, StoryRunner } from "./runner.js";
export { checkStory, prepareStory, step, stories, stressStory } from "./stories.js";
export { StoryLink } from "./ui/link.js";
export { StoryPanel } from "./ui/story-panel.js";
export { Storybook } from "./ui/storybook.js";
export { StressPanel } from "./ui/stress-panel.js";

import { defineTutucaApp, REQUEST } from "../embed/element.js";
import { StoryRegistry, storyAskHandlers } from "./runner.js";
import { StoryLink } from "./ui/link.js";
import { panelClassNames, panelComponents } from "./ui/panels.js";
import { Storybook } from "./ui/storybook.js";

export const storybookComponents = { Storybook, StoryLink, ...panelComponents };

export const storybookClasses = () =>
	classNamesOf(Object.values(storybookComponents), panelClassNames);

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
	const appKey = `${selected?.id ?? ""}@0`;
	return C.Storybook({
		links,
		selectedId: selected?.id ?? "",
		isGenerated: selected?.isGenerated ?? false,
		story: C.StoryPanel({ appKey }),
		stress: C.StressPanel({ appKey }),
		dev: makeDevPanel(C),
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
	rootNode.addEventListener(REQUEST, (e) => registry.mount(e.detail));
	const host = new Host({ document, rootNode, dev });
	host.scope.register(storybookComponents);
	host.scope.registerAskHandlers({
		...storyAskHandlers(() => registry),
		scrollToTop: () => {
			for (const node of [rootNode.querySelector("[data-story-main]"), document.scrollingElement]) {
				if (node) node.scrollTop = 0;
			}
		},
	});
	host.start(makeStorybook(host.scope.components, books, initialId));
	return { host, registry };
};
