import { drawingComponents } from "../../components/drawing/index.js";
import { houseDrawing } from "../../components/drawing/stories.js";
import { boot } from "../boot.js";

export const start = (document = globalThis.document) =>
	boot({
		document,
		components: drawingComponents,
		make: (C) => houseDrawing(C),
	});

if (globalThis.document?.getElementById("app")) start();
