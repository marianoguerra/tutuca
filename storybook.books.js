// Every book of stories the storybook shows and the tests check.

import compositionBook from "./components/composition/stories.js";
import drawingBook from "./components/drawing/stories.js";
import jsonBook from "./components/json/stories.js";
import jsonSchemaBook, { studioBook } from "./components/json-schema/stories.js";
import kanbanBook from "./components/kanban/stories.js";
import langBook from "./components/lang/stories.js";
import mathBook, { workbenchBook } from "./components/math/stories.js";
import trackerBook from "./components/thing-tracker/stories.js";
import todoBook from "./components/todo/stories.js";
import treeSpecBook from "./components/tree-spec/stories.js";
import devBook from "./components/tutuca-dev/stories.js";

export const books = [
	drawingBook,
	compositionBook,
	kanbanBook,
	langBook,
	mathBook,
	workbenchBook,
	trackerBook,
	todoBook,
	treeSpecBook,
	jsonBook,
	jsonSchemaBook,
	studioBook,
	devBook,
];
