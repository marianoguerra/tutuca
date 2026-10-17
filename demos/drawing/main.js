import { drawingComponents } from "../../components/drawing/index.js";
import { houseDrawing } from "../../components/drawing/stories.js";
import { boot, browserHandlers } from "../boot.js";

export const start = (document = globalThis.document) =>
	boot({
		document,
		components: drawingComponents,
		askHandlers: { saveFile: browserHandlers.saveFile },
		make: (C) => houseDrawing(C),
	});

if (globalThis.document?.getElementById("app")) start();
