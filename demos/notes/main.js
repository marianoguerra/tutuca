import { boot } from "../boot.js";
import { notesComponents } from "./notes.js";

export const start = (document = globalThis.document) =>
	boot({ document, components: notesComponents, make: (C) => C.Notes() });

if (globalThis.document?.getElementById("app")) start();
