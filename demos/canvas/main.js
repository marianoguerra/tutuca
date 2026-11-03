import { canvas, canvasComponents } from "../../components/canvas/index.js";
import { boot } from "../boot.js";

export const start = (document = globalThis.document) =>
	boot({
		document,
		components: canvasComponents,
		make: (C) =>
			canvas(C, [
				[48, 48, C.Notes({ title: "Notes" })],
				[420, 120, C.Hole()],
			]),
	});

if (globalThis.document?.getElementById("app")) start();
