// Every book of stories the storybook shows and the tests check.

import drawingBook from "./components/drawing/stories.js";
import jsonBook from "./components/json/stories.js";
import jsonSchemaBook, { studioBook } from "./components/jsonschema/stories.js";
import mathBook, { workbenchBook } from "./components/math/stories.js";
import trackerBook from "./components/thing-tracker/stories.js";
import todoBook from "./components/todo/stories.js";
import devBook from "./components/tutuca-dev/stories.js";

export const books = [
	drawingBook,
	mathBook,
	workbenchBook,
	trackerBook,
	todoBook,
	jsonBook,
	jsonSchemaBook,
	studioBook,
	devBook,
];
